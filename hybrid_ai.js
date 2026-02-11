// ============================================================
// ハイブリッド AI 関数 (hybrid_ai.js)
// ============================================================
// このファイルは、Google の Gemini API と OpenRouter API を
// 組み合わせて使う「askAI」関数を提供します。
//
// 【動作の流れ】
//  1. まず Gemini のモデルを上から順に試す
//  2. Gemini が全滅したら OpenRouter のモデルを上から順に試す
//  3. それでもダメなら openrouter/free（自動選択）を最終手段として試す
//  4. 全部ダメならエラーメッセージを返す
//
// 【エラー時の戻り値プレフィックス】
//  🔑APIキー未設定  → スクリプトプロパティにキーがない
//  🔑認証エラー     → APIキーが無効・期限切れ (401/403)
//  ⏳レート制限     → API呼び出し回数の上限超過 (429)
//  ❌モデル不明     → 指定モデルが存在しない (404)
//  ⚠️リクエスト不正 → パラメータに問題 (400)
//  💔サーバーエラー → API側の障害 (500/502/503)
//  🔌接続エラー     → ネットワーク障害
//  📭空回答         → APIは成功だが回答が空
//  💀全API失敗      → すべてのモデル・手段が失敗
//
// 【showModel=TRUE 時の表示例】
//  【gemini-3-flash-preview | 128tok | 1.2s】
//
// 【使い方の例（スプレッドシートから）】
//  =askAI("こんにちは")                     ← 最小構成
//  =askAI("質問","先生として回答")           ← 役割を指定
//  =askAI("質問","先生",0.5)               ← 温度(創造性)も指定
//  =askAI("質問",,,,TRUE)                  ← モデル名+トークン数+応答時間を表示
//
// 【他の関数との違い】
//  - askAI  : Gemini優先 → OpenRouterフォールバック（最も信頼性が高い）
//  - my_AI  : OpenRouterのみ（openrouter.js）
//  - gemn   : Geminiのみ（gemini.js）
// ============================================================


// ============================================================
// 1. 基本設定（APIキーやモデルの定義）
// ============================================================
function _getConfig() {
    const props = PropertiesService.getScriptProperties();
    return {
        GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY'),
        GEMINI_MODELS: [
            "gemini-3-flash-preview",
            "gemini-2.5-flash"
        ],
        OPENROUTER_API_KEY: props.getProperty('OPENROUTER_API_KEY'),
        OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',
        OPENROUTER_MODELS: [
            "stepfun/step-3.5-flash:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "tngtech/deepseek-r1t2-chimera:free",
            "google/gemma-3-27b-it:free",
            "nvidia/nemotron-3-nano-30b-a3b:free"
        ],
        OPENROUTER_FREE_MODEL: "openrouter/free",
        MAX_TOKENS: 1024,
        MAX_RETRY: 2
    };
}

// 設定の遅延初期化
let _hybridConfig = null;
function _getHybridConfig() {
    if (!_hybridConfig) _hybridConfig = _getConfig();
    return _hybridConfig;
}


// ============================================================
// エラー分類ヘルパー（共通）
// ============================================================
// HTTPステータスコードからエラーの種別を判定する。
//
// 戻り値:
//   { prefix: "表示用プレフィックス", shouldRetry: リトライすべきか }
// ============================================================
function _classifyHttpError(statusCode) {
    switch (statusCode) {
        case 400: return { prefix: "【⚠️リクエスト不正】", shouldRetry: false };
        case 401: return { prefix: "【🔑認証エラー】", shouldRetry: false };
        case 403: return { prefix: "【🔑認証エラー】", shouldRetry: false };
        case 404: return { prefix: "【❌モデル不明】", shouldRetry: false };
        case 429: return { prefix: "【⏳レート制限】", shouldRetry: true };
        case 500: return { prefix: "【💔サーバーエラー】", shouldRetry: true };
        case 502: return { prefix: "【💔サーバーエラー】", shouldRetry: true };
        case 503: return { prefix: "【💔サーバーエラー】", shouldRetry: true };
        default: return { prefix: "【⚠️HTTPエラー(" + statusCode + ")】", shouldRetry: true };
    }
}


// ============================================================
// showModel 表示ヘルパー
// ============================================================
// 「【モデル名 | 128tok | 1.2s】」形式のヘッダーを生成
// ============================================================
function _formatModelHeader(modelName, tokens, elapsedMs) {
    const tokStr = tokens ? tokens + "tok" : "?tok";
    const secStr = elapsedMs ? (elapsedMs / 1000).toFixed(1) + "s" : "?s";
    return "【" + modelName + " | " + tokStr + " | " + secStr + "】";
}


// ============================================================
// 2. メインの AI 関数: askAI
// ============================================================
/**
 * ハイブリッドAI関数: askAI
 * Gemini API → OpenRouter → OpenRouter Free の順でフォールバック
 *
 * @param {string}  promptText  今回の質問 (必須)
 * @param {string}  systemInst  AIの役割・ルール (任意)
 * @param {number}  temp        温度 0.0〜2.0 (初期値 0.3)
 * @param {Range}   fewShotRange 例示の範囲 [入力例, 出力例] (任意)
 * @param {Range}   historyRange 過去の対話範囲 [自分, AI] (任意)
 * @param {boolean} showModel   使用モデル名+トークン数+応答時間を表示するか (初期値: false)
 * @customfunction
 */
function askAI(promptText, systemInst, temp, fewShotRange, historyRange, showModel) {
    const config = _getHybridConfig();

    // 引数の補正処理
    systemInst = systemInst || "";
    temp = (temp === undefined || temp === null || temp === "") ? 0.3 : Number(temp);
    fewShotRange = fewShotRange || null;
    historyRange = historyRange || null;
    showModel = (showModel === true || showModel === "TRUE" || showModel === "true");

    if (!promptText) return "【通知】質問を入力してください。";



    // ----------------------------------------------------------
    // 試行結果を記録する配列（最終エラーメッセージ用）
    // ----------------------------------------------------------
    const trialLog = [];

    // ============================================================
    // 1. Gemini モデル群で試行
    // ============================================================
    for (const model of config.GEMINI_MODELS) {
        const result = _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, model, config);

        if (result.success) {
            _logAIUsage(model, promptText, "成功", "Gemini", result.elapsedMs, result.tokens);
            return showModel ? _formatModelHeader(model, result.tokens, result.elapsedMs) + "\n" + result.text : result.text;
        }
        trialLog.push(`Gemini(${model}): ${result.errorDetail}`);
        console.warn(`【Gemini失敗】${model}: ${result.errorDetail}`);
    }

    // ============================================================
    // 2. OpenRouter モデル群で試行
    // ============================================================
    if (config.OPENROUTER_MODELS && config.OPENROUTER_MODELS.length > 0) {
        for (const model of config.OPENROUTER_MODELS) {
            const result = _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, model);
            if (result.success) {
                const displayModel = result.actualModel || model;

                _logAIUsage(displayModel, promptText, "成功", "OpenRouter", result.elapsedMs, result.tokens);
                return showModel ? _formatModelHeader(displayModel, result.tokens, result.elapsedMs) + "\n" + result.text : result.text;
            }
            trialLog.push(`OR(${model}): ${result.errorDetail}`);
            console.warn(`【OpenRouter失敗】${model}: ${result.errorDetail}`);
        }
    }

    // ============================================================
    // 3. 最終手段: OpenRouter Free
    // ============================================================
    const freeModel = config.OPENROUTER_FREE_MODEL;
    const freeResult = _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, freeModel);

    if (freeResult.success) {
        const displayModel = freeResult.actualModel || freeModel;

        _logAIUsage(displayModel, promptText, "成功(Free)", "OpenRouter", freeResult.elapsedMs, freeResult.tokens);
        return showModel ? _formatModelHeader(displayModel, freeResult.tokens, freeResult.elapsedMs) + "\n" + freeResult.text : freeResult.text;
    }
    trialLog.push(`OR(Free): ${freeResult.errorDetail}`);

    // ----------------------------------------------------------
    // 全滅 → 試行結果のサマリーを返す
    // ----------------------------------------------------------
    _logAIUsage("N/A", promptText, "全API失敗", "N/A", 0, 0);
    return "【💀全API失敗】\n" + trialLog.join("\n");
}


// ============================================================
// 3. Gemini API 呼び出し（内部関数）
// ============================================================
// 戻り値:
//   成功時: { success: true,  text: "回答", elapsedMs: 数値, tokens: 数値 }
//   失敗時: { success: false, errorDetail: "分類済みエラー文" }
// ============================================================
function _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, model, config) {
    // -- APIキー未設定チェック --
    const API_KEY = config.GEMINI_API_KEY;
    if (!API_KEY) return { success: false, errorDetail: "【🔑APIキー未設定】GEMINI_API_KEY をプロジェクト設定で登録してください" };

    const URL = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + API_KEY;

    // Gemini形式の会話データを組み立て
    const contents = [];
    if (fewShotRange && Array.isArray(fewShotRange)) {
        fewShotRange.forEach(row => {
            if (row[0] && row[1]) {
                contents.push({ role: "user", parts: [{ text: "Ex: " + row[0] }] });
                contents.push({ role: "model", parts: [{ text: "Ans: " + row[1] }] });
            }
        });
    }
    if (historyRange && Array.isArray(historyRange)) {
        historyRange.forEach(row => {
            if (row[0]) contents.push({ role: "user", parts: [{ text: row[0].toString() }] });
            if (row[1]) contents.push({ role: "model", parts: [{ text: row[1].toString() }] });
        });
    }
    contents.push({ role: "user", parts: [{ text: promptText }] });

    const payload = {
        contents: contents,
        generationConfig: { temperature: Number(temp), maxOutputTokens: config.MAX_TOKENS },
        system_instruction: systemInst ? { role: "system", parts: [{ text: systemInst }] } : undefined
    };
    const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    // ----------------------------------------------------------
    // リトライループ
    // ----------------------------------------------------------
    let lastErrorDetail = "";

    for (let attempt = 1; attempt <= config.MAX_RETRY; attempt++) {
        const startTime = Date.now();
        try {
            const response = UrlFetchApp.fetch(URL, options);
            const elapsedMs = Date.now() - startTime;
            const responseCode = response.getResponseCode();
            const responseText = response.getContentText();

            // -- 成功 (200) --
            if (responseCode === 200) {
                const json = JSON.parse(responseText);
                // Geminiのトークン数を取得（usageMetadata にある）
                const tokens = (json.usageMetadata && json.usageMetadata.totalTokenCount) || 0;
                if (json.candidates && json.candidates[0] && json.candidates[0].content) {
                    const answer = json.candidates[0].content.parts[0].text.trim();
                    if (answer !== "") return { success: true, text: answer, elapsedMs: elapsedMs, tokens: tokens };
                    // 空回答 → リトライ対象
                    lastErrorDetail = "【📭空回答】モデルが空の回答を返しました";
                    if (attempt < config.MAX_RETRY) { Utilities.sleep(1000); }
                    continue;
                }
                lastErrorDetail = "【📭空回答】回答データの構造が不正です";
                if (attempt < config.MAX_RETRY) { Utilities.sleep(1000); }
                continue;
            }

            // -- エラー応答 --
            const classification = _classifyHttpError(responseCode);
            let apiMsg = "";
            try {
                const errorJson = JSON.parse(responseText);
                apiMsg = errorJson.error ? errorJson.error.message : "";
            } catch (e) {
                apiMsg = responseText.substring(0, 150);
            }
            lastErrorDetail = classification.prefix + apiMsg;

            // リトライ不要のエラー → 即リターン（次のモデルへ進む）
            if (!classification.shouldRetry) {
                return { success: false, errorDetail: lastErrorDetail };
            }

            // リトライ対象 → 待機して再試行
            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(1000);
            }

        } catch (e) {
            // ネットワーク/接続エラー → リトライ対象
            lastErrorDetail = "【🔌接続エラー】" + e.message;
            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(1000);
            }
        }
    }

    return { success: false, errorDetail: lastErrorDetail };
}


// ============================================================
// 4. OpenRouter API 呼び出し（内部関数）
// ============================================================
// 戻り値:
//   成功時: { success: true, text: "回答", actualModel: "モデル名", elapsedMs: 数値, tokens: 数値 }
//   失敗時: { success: false, errorDetail: "分類済みエラー文" }
// ============================================================
function _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, model) {
    // -- APIキー未設定チェック --
    if (!config.OPENROUTER_API_KEY) return { success: false, errorDetail: "【🔑APIキー未設定】OPENROUTER_API_KEY をプロジェクト設定で登録してください" };

    // メッセージ組み立て
    const messages = [];
    if (systemInst) messages.push({ role: "system", content: systemInst });
    if (fewShotRange && Array.isArray(fewShotRange)) {
        fewShotRange.forEach(row => {
            if (row[0] && row[1]) {
                messages.push({ role: "user", content: "Ex: " + row[0] });
                messages.push({ role: "assistant", content: "Ans: " + row[1] });
            }
        });
    }
    if (historyRange && Array.isArray(historyRange)) {
        historyRange.forEach(row => {
            if (row[0]) messages.push({ role: "user", content: row[0].toString() });
            if (row[1]) messages.push({ role: "assistant", content: row[1].toString() });
        });
    }
    messages.push({ role: "user", content: promptText });

    const payload = {
        model: model,
        messages: messages,
        temperature: Number(temp),
        max_tokens: config.MAX_TOKENS
    };
    const options = {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": "Bearer " + config.OPENROUTER_API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    // ----------------------------------------------------------
    // リトライループ
    // ----------------------------------------------------------
    let lastErrorDetail = "";

    for (let attempt = 1; attempt <= config.MAX_RETRY; attempt++) {
        const startTime = Date.now();
        try {
            const response = UrlFetchApp.fetch(config.OPENROUTER_URL, options);
            const elapsedMs = Date.now() - startTime;
            const statusCode = response.getResponseCode();
            const responseText = response.getContentText();

            // -- 成功 (200) --
            if (statusCode === 200) {
                let json;
                try { json = JSON.parse(responseText); } catch (e) {
                    lastErrorDetail = "【⚠️リクエスト不正】レスポンスのJSON解析に失敗: " + responseText.substring(0, 100);
                    if (attempt < config.MAX_RETRY) { Utilities.sleep(1000); }
                    continue;
                }
                // OpenRouterのトークン数を取得（usage.total_tokens にある）
                const tokens = (json.usage && json.usage.total_tokens) || 0;
                if (json.choices && json.choices[0] && json.choices[0].message) {
                    const answer = json.choices[0].message.content.trim();
                    if (answer !== "") {
                        return { success: true, text: answer, actualModel: json.model, elapsedMs: elapsedMs, tokens: tokens };
                    }
                    lastErrorDetail = "【📭空回答】モデルが空の回答を返しました";
                    if (attempt < config.MAX_RETRY) { Utilities.sleep(1000); }
                    continue;
                }
                lastErrorDetail = "【📭空回答】回答データの構造が不正です";
                if (attempt < config.MAX_RETRY) { Utilities.sleep(1000); }
                continue;
            }

            // -- エラー応答 --
            const classification = _classifyHttpError(statusCode);
            let apiMsg = "";
            try {
                const errorJson = JSON.parse(responseText);
                apiMsg = errorJson.error ? errorJson.error.message : "";
            } catch (e) {
                apiMsg = responseText.substring(0, 150);
            }
            lastErrorDetail = classification.prefix + apiMsg;

            // リトライ不要のエラー → 即リターン
            if (!classification.shouldRetry) {
                return { success: false, errorDetail: lastErrorDetail };
            }

            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(1000);
            }

        } catch (e) {
            lastErrorDetail = "【🔌接続エラー】" + e.toString();
            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(1000);
            }
        }
    }

    return { success: false, errorDetail: lastErrorDetail };
}
