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
// 【使い方の例（スプレッドシートから）】
//  =askAI("こんにちは")                     ← 最小構成
//  =askAI("質問","先生として回答")           ← 役割を指定
//  =askAI("質問","先生",0.5)               ← 温度(創造性)も指定
//  =askAI("質問",,,,TRUE)                  ← モデル名表示あり（カンマ4個）
//
// 【他の関数との違い】
//  - askAI  : Gemini優先 → OpenRouterフォールバック（最も信頼性が高い）
//  - my_AI  : OpenRouterのみ（openrouter.js）
//  - gemn   : Geminiのみ（gemini.js）
// ============================================================


// ============================================================
// 1. 基本設定（APIキーやモデルの定義）
// ============================================================
// ※ APIキーは「プロジェクト設定 > スクリプトプロパティ」で
//    GEMINI_API_KEY / OPENROUTER_API_KEY を登録してください。
// ============================================================
function _getConfig() {
    const props = PropertiesService.getScriptProperties();
    return {
        // Gemini の APIキー（スクリプトプロパティから取得）
        GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY'),

        // Gemini で試行するモデルのリスト（上から順番に試す）
        GEMINI_MODELS: [
            "gemini-3-flash-preview",         // Gemini 3 Flash（最新・最速）
            "gemini-2.5-flash-preview",       // Gemini 2.5 Flash
            "gemini-2.0-flash-preview",       // Gemini 2.0 Flash
            "gemini-1.5-flash-preview",       // Gemini 1.5 Flash
            "gemini-1.5-pro-preview"          // Gemini 1.5 Pro（高性能）
        ],

        // OpenRouter の APIキー（スクリプトプロパティから取得）
        OPENROUTER_API_KEY: props.getProperty('OPENROUTER_API_KEY'),

        // OpenRouter の API エンドポイント（変更不要）
        OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',

        // OpenRouter で試行するモデルのリスト（上から順番に試す）
        // ":free" が付いているものは無料モデル
        OPENROUTER_MODELS: [
            "meta-llama/llama-3.3-70b-instruct:free",     // Meta Llama 3.3 70B（高性能）
            "meta-llama/llama-3.2-3b-instruct:free",      // Meta Llama 3.2 3B（軽量）
            "arcee-ai/trinity-large-preview:free",         // Arcee Trinity Large
            "nvidia/nemotron-3-nano-30b-a3b:free",         // NVIDIA Nemotron
            "tngtech/deepseek-r1t2-chimera:free"           // DeepSeek Chimera
        ],

        // 最終手段: OpenRouter が空いている無料モデルを自動選択するメタモデル
        OPENROUTER_FREE_MODEL: "openrouter/free",

        // AIの回答の最大文字数（トークン数）
        MAX_TOKENS: 1024,

        // 各モデルごとのリトライ回数（通信エラーなどに備える）
        MAX_RETRY: 3
    };
}

// ----------------------------------------------------------
// 設定の遅延初期化
// ----------------------------------------------------------
// スプレッドシートのカスタム関数(@customfunction)から呼ばれたとき、
// 毎回設定を読み込むのは無駄なので、初回のみ読み込んでキャッシュする。
// ----------------------------------------------------------
let _hybridConfig = null;
function _getHybridConfig() {
    if (!_hybridConfig) _hybridConfig = _getConfig();
    return _hybridConfig;
}


// ============================================================
// 2. メインの AI 関数: askAI
// ============================================================
// スプレッドシートから =askAI("質問") で呼び出す関数
// Gemini → OpenRouter → Free の順でフォールバック
// ============================================================
/**
 * ハイブリッドAI関数: askAI
 * Gemini API (複数モデル順次試行) -> OpenRouter (複数モデル順次試行) -> OpenRouter Free の順でフォールバック
 * スプレッドシートから直接呼び出し可能。
 *
 * @param {string}  promptText  今回の質問 (必須)
 * @param {string}  systemInst  AIの役割・ルール (任意) 例: "英語教師として回答して"
 * @param {number}  temp        温度 0.0〜2.0 (初期値 0.3)。高いほど創造的、低いほど正確
 * @param {Range}   fewShotRange 例示の範囲 [入力例, 出力例] (任意)
 * @param {Range}   historyRange 過去の対話範囲 [自分, AI] (任意)
 * @param {boolean} showModel   使用されたモデル名を回答先頭に表示するか (初期値: false)
 * @customfunction
 */
function askAI(promptText, systemInst, temp, fewShotRange, historyRange, showModel) {
    // 設定を読み込む
    const config = _getHybridConfig();

    // ----------------------------------------------------------
    // 引数の補正処理
    // ----------------------------------------------------------
    // スプレッドシートのカスタム関数では空セルが "" で渡されるため、
    // 手動でデフォルト値を設定する。
    systemInst = systemInst || "";                                                     // 空なら空文字
    temp = (temp === undefined || temp === null || temp === "") ? 0.3 : Number(temp);   // 空なら0.3
    fewShotRange = fewShotRange || null;                                               // 空ならnull
    historyRange = historyRange || null;                                               // 空ならnull
    showModel = (showModel === true || showModel === "TRUE" || showModel === "true");   // TRUE判定

    // 入力チェック
    if (!promptText) return "【通知】質問を入力してください。";

    // ----------------------------------------------------------
    // 0. キャッシュチェック（同じ質問の再利用で高速化）
    // ----------------------------------------------------------
    // 同じ質問+設定の組み合わせなら、過去の回答をそのまま返す（6時間有効）
    const cacheKey = _makeCacheKey(promptText, systemInst, temp);
    const cached = _getCachedAnswer(cacheKey);
    if (cached) {
        return showModel ? "【キャッシュ】\n" + cached : cached;
    }

    let lastError = "";

    // ============================================================
    // 1. Gemini モデル群で試行 (上から順に)
    // ============================================================
    // まず Google の Gemini API を試す（速度・品質が最も良い）
    for (const model of config.GEMINI_MODELS) {
        const result = _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, model, config);
        if (result.success) {
            // 成功！キャッシュに保存してログ記録
            _setCachedAnswer(cacheKey, result.text);
            _logAIUsage(model, promptText, "成功", "Gemini");
            return showModel ? "【" + model + "】\n" + result.text : result.text;
        }
        // 失敗 → 次のモデルを試す
        lastError = `Gemini(${model}): ${result.error}`;
        console.warn(`【Gemini失敗】${model}: ${result.error}`);
    }

    // ============================================================
    // 2. OpenRouter モデル群で試行 (上から順に)
    // ============================================================
    // Gemini がすべて失敗した場合、OpenRouter の無料モデルを試す
    if (config.OPENROUTER_MODELS && config.OPENROUTER_MODELS.length > 0) {
        for (const model of config.OPENROUTER_MODELS) {
            const result = _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, model);
            if (result.success) {
                _setCachedAnswer(cacheKey, result.text);
                // actualModel: OpenRouter が実際にルーティングしたモデル名
                _logAIUsage(result.actualModel || model, promptText, "成功", "OpenRouter");
                return showModel ? "【" + (result.actualModel || model) + "】\n" + result.text : result.text;
            }
            lastError = `OpenRouter(${model}): ${result.error}`;
            console.warn(`【OpenRouter失敗】${model}: ${result.error}`);
        }
    }

    // ============================================================
    // 3. 最終手段: OpenRouter Free（自動モデル選択）
    // ============================================================
    // openrouter/free は OpenRouter が空いている無料モデルを自動選択する
    const freeModel = config.OPENROUTER_FREE_MODEL;
    const freeResult = _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, freeModel);

    if (freeResult.success) {
        _setCachedAnswer(cacheKey, freeResult.text);
        _logAIUsage(freeResult.actualModel || freeModel, promptText, "成功(Free)", "OpenRouter");
        return showModel ? "【" + (freeResult.actualModel || freeModel) + "】\n" + freeResult.text : freeResult.text;
    }

    // 全滅 → エラーメッセージを返す
    const finalError = `【全API失敗】Last Error: ${freeResult.error}`;
    _logAIUsage("N/A", promptText, "全API失敗", "N/A");
    return finalError;
}


// ============================================================
// 3. Gemini API 呼び出し（内部関数）
// ============================================================
// Google の Gemini API に直接リクエストを送る。
// 会話履歴やFew-shot例示にも対応。
//
// 戻り値:
//   成功時: { success: true,  text: "AIの回答" }
//   失敗時: { success: false, error: "エラー理由" }
// ============================================================
function _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, model, config) {
    // APIキーが未設定ならすぐにエラーを返す
    const API_KEY = config.GEMINI_API_KEY;
    if (!API_KEY) return { success: false, error: "GEMINI_API_KEY 未設定" };

    // Gemini API の URL を構築（モデル名とAPIキーを埋め込む）
    const URL = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + API_KEY;

    // ----------------------------------------------------------
    // Gemini形式の会話データ(contents)を組み立て
    // ----------------------------------------------------------
    const contents = [];

    // ① Few-shot（例題）があれば、会話形式で追加
    //    スプレッドシートの範囲を [入力例, 出力例] の形で渡す
    if (fewShotRange && Array.isArray(fewShotRange)) {
        fewShotRange.forEach(row => {
            if (row[0] && row[1]) {
                contents.push({ role: "user", parts: [{ text: "Ex: " + row[0] }] });
                contents.push({ role: "model", parts: [{ text: "Ans: " + row[1] }] });
            }
        });
    }

    // ② 会話履歴があれば追加
    //    過去の対話を [自分の発言, AIの回答] の形で渡す
    if (historyRange && Array.isArray(historyRange)) {
        historyRange.forEach(row => {
            if (row[0]) contents.push({ role: "user", parts: [{ text: row[0].toString() }] });
            if (row[1]) contents.push({ role: "model", parts: [{ text: row[1].toString() }] });
        });
    }

    // ③ 今回の質問を追加
    contents.push({ role: "user", parts: [{ text: promptText }] });

    // ----------------------------------------------------------
    // APIリクエストのデータを組み立て
    // ----------------------------------------------------------
    const payload = {
        contents: contents,                  // 会話データ
        generationConfig: {
            temperature: Number(temp),       // 温度（創造性）
            maxOutputTokens: config.MAX_TOKENS  // 回答の最大長
        },
        // システム指示（AIの役割設定）がある場合のみ追加
        system_instruction: systemInst
            ? { role: "system", parts: [{ text: systemInst }] }
            : undefined
    };

    // HTTPリクエストの設定
    const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),    // データをJSON文字列に変換
        muteHttpExceptions: true             // エラー時もクラッシュせず結果を取得
    };

    // ----------------------------------------------------------
    // リトライループ: 最大 MAX_RETRY 回試す
    // ----------------------------------------------------------
    for (let attempt = 1; attempt <= config.MAX_RETRY; attempt++) {
        try {
            // APIにリクエスト送信
            const response = UrlFetchApp.fetch(URL, options);
            const responseCode = response.getResponseCode();
            const responseText = response.getContentText();

            // 成功判定: ステータス200 かつ 回答データあり
            if (responseCode === 200) {
                const json = JSON.parse(responseText);
                if (json.candidates && json.candidates[0].content) {
                    const answer = json.candidates[0].content.parts[0].text.trim();
                    if (answer !== "") return { success: true, text: answer };
                }
            }

            // エラー内容を取得
            let errorMsg = "";
            try {
                const errorJson = JSON.parse(responseText);
                errorMsg = errorJson.error ? errorJson.error.message : "コード: " + responseCode;
            } catch (e) {
                // レスポンスがJSONでなければ先頭200文字をエラーメッセージに
                errorMsg = responseText.substring(0, 200);
            }

            // まだリトライ可能なら待機して再試行
            // 待ち時間: 1回目→2秒、2回目→4秒、3回目→6秒
            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(attempt * 2000);
            }

            // 最後の試行だったらエラーを返す
            if (attempt === config.MAX_RETRY) {
                return { success: false, error: errorMsg };
            }

        } catch (e) {
            // ネットワークエラーなど予期しないエラー
            if (attempt === config.MAX_RETRY) {
                return { success: false, error: "接続エラー: " + e.message };
            }
            Utilities.sleep(attempt * 2000);
        }
    }

    // ここには通常到達しない（安全のためのフォールバック）
    return { success: false, error: "不明なエラー" };
}


// ============================================================
// 4. OpenRouter API 呼び出し（内部関数）
// ============================================================
// OpenRouter API にリクエストを送る。
// Gemini とは API の形式が異なるため、別関数で処理する。
//
// 戻り値:
//   成功時: { success: true,  text: "AIの回答", actualModel: "実際のモデル名" }
//   失敗時: { success: false, error: "エラー理由" }
// ============================================================
function _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, model) {
    // APIキーが未設定ならすぐにエラーを返す
    if (!config.OPENROUTER_API_KEY) return { success: false, error: "OPENROUTER_API_KEY 未設定" };

    // ----------------------------------------------------------
    // OpenRouter形式のメッセージデータを組み立て
    // ----------------------------------------------------------
    const messages = [];

    // ① システム指示（AIの役割設定）があれば追加
    if (systemInst) messages.push({ role: "system", content: systemInst });

    // ② Few-shot（例題）があれば追加
    if (fewShotRange && Array.isArray(fewShotRange)) {
        fewShotRange.forEach(row => {
            if (row[0] && row[1]) {
                messages.push({ role: "user", content: "Ex: " + row[0] });
                messages.push({ role: "assistant", content: "Ans: " + row[1] });
            }
        });
    }

    // ③ 会話履歴があれば追加
    if (historyRange && Array.isArray(historyRange)) {
        historyRange.forEach(row => {
            if (row[0]) messages.push({ role: "user", content: row[0].toString() });
            if (row[1]) messages.push({ role: "assistant", content: row[1].toString() });
        });
    }

    // ④ 今回の質問を追加
    messages.push({ role: "user", content: promptText });

    // ----------------------------------------------------------
    // APIリクエストのデータを組み立て
    // ----------------------------------------------------------
    const payload = {
        model: model,            // 使用するAIモデル
        messages: messages,      // 会話履歴+質問
        temperature: Number(temp),  // 温度（創造性）
        max_tokens: config.MAX_TOKENS  // 回答の最大長
    };

    // HTTPリクエストの設定
    const options = {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": "Bearer " + config.OPENROUTER_API_KEY },  // APIキーを添付
        payload: JSON.stringify(payload),    // データをJSON文字列に変換
        muteHttpExceptions: true             // エラー時もクラッシュせず結果を取得
    };

    // ----------------------------------------------------------
    // リトライループ: 最大 MAX_RETRY 回試す
    // ----------------------------------------------------------
    for (let attempt = 1; attempt <= config.MAX_RETRY; attempt++) {
        try {
            // APIにリクエスト送信
            const response = UrlFetchApp.fetch(config.OPENROUTER_URL, options);
            const json = JSON.parse(response.getContentText());
            const statusCode = response.getResponseCode();

            // 成功判定: ステータス200 かつ 回答データあり
            if (statusCode === 200 && json.choices && json.choices[0]) {
                const answer = json.choices[0].message.content.trim();
                if (answer !== "") {
                    // json.model に OpenRouter が実際に使ったモデル名が入る
                    return { success: true, text: answer, actualModel: json.model };
                }
            }

            // エラー内容を取得
            const errorMsg = json.error ? json.error.message : "ステータスコード: " + statusCode;

            // まだリトライ可能なら待機して再試行
            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(attempt * 2000);
            }

            // 最後の試行だったらエラーを返す
            if (attempt === config.MAX_RETRY) {
                return { success: false, error: errorMsg };
            }

        } catch (e) {
            // ネットワークエラーなど予期しないエラー
            if (attempt === config.MAX_RETRY) {
                return { success: false, error: "接続エラー: " + e.toString() };
            }
            Utilities.sleep(attempt * 2000);
        }
    }

    // ここには通常到達しない
    return { success: false, error: "不明なエラー" };
}
