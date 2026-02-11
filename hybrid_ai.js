// ============================================================
// ハイブリッドAI関数
// Gemini API を優先し、エラー時に OpenRouter 無料枠へフォールバック
// ============================================================

// APIキー取得（PropertiesService優先、未設定ならエラー）
function _getConfig() {
    const props = PropertiesService.getScriptProperties();
    return {
        GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY'),
        GEMINI_MODELS: [
            "gemini-3-flash-preview",
            "gemini-2.5-flash-preview",
            "gemini-2.0-flash-preview",
            "gemini-1.5-flash-preview",
            "gemini-1.5-pro-preview"
        ],
        OPENROUTER_API_KEY: props.getProperty('OPENROUTER_API_KEY'),
        OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',
        OPENROUTER_MODELS: [
            "meta-llama/llama-3.3-70b-instruct:free",
            "meta-llama/llama-3.2-3b-instruct:free",
            "arcee-ai/trinity-large-preview:free",
            "nvidia/nemotron-3-nano-30b-a3b:free",
            "tngtech/deepseek-r1t2-chimera:free"
        ],
        OPENROUTER_FREE_MODEL: "openrouter/free",
        MAX_TOKENS: 1024,
        MAX_RETRY: 3
    };
}

// グローバル定数（遅延初期化：customfunction でも安全に動作）
let _hybridConfig = null;
function _getHybridConfig() {
    if (!_hybridConfig) _hybridConfig = _getConfig();
    return _hybridConfig;
}

/**
 * ハイブリッドAI関数: askAI
 * Gemini API (複数モデル順次試行) -> OpenRouter (複数モデル順次試行) -> OpenRouter Free の順でフォールバック
 * スプレッドシートから直接呼び出し可能。
 * @param {string} promptText 今回の質問 (必須)
 * @param {string} systemInst AIの役割・ルール (任意)
 * @param {number} temp 温度感 0.0-2.0 (初期値 0.3)
 * @param {Range} fewShotRange 例示の範囲 [入力例, 出力例] (任意)
 * @param {Range} historyRange 過去の対話範囲 [自分, AI] (任意)
 * @param {boolean} showModel 使用されたモデル名を表示するか (初期値: false)
 * @customfunction
 */
function askAI(promptText, systemInst, temp, fewShotRange, historyRange, showModel) {
    const config = _getHybridConfig();

    // デフォルト値 + 型変換（@customfunction は全て文字列で渡される）
    systemInst = systemInst || "";
    temp = (temp === undefined || temp === null || temp === "") ? 0.3 : Number(temp);
    fewShotRange = fewShotRange || null;
    historyRange = historyRange || null;
    // geminiModel 引数は廃止されました
    showModel = (showModel === true || showModel === "TRUE" || showModel === "true");

    if (!promptText) return "【通知】質問を入力してください。";

    // ============================================================
    // 0. キャッシュチェック（同じ質問は再利用）
    // ============================================================
    const cacheKey = _makeCacheKey(promptText, systemInst, temp);
    const cached = _getCachedAnswer(cacheKey);
    if (cached) {
        return showModel ? "【キャッシュ】\n" + cached : cached;
    }

    let lastError = "";

    // ============================================================
    // 1. Gemini モデル群で試行 (上から順に)
    // ============================================================
    for (const model of config.GEMINI_MODELS) {
        const result = _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, model, config);
        if (result.success) {
            _setCachedAnswer(cacheKey, result.text);
            _logAIUsage(model, promptText, "成功", "Gemini");
            return showModel ? "【" + model + "】\n" + result.text : result.text;
        }
        lastError = `Gemini(${model}): ${result.error}`;
        console.warn(`【Gemini失敗】${model}: ${result.error}`);
    }

    // ============================================================
    // 2. OpenRouter モデル群で試行 (上から順に)
    // ============================================================
    if (config.OPENROUTER_MODELS && config.OPENROUTER_MODELS.length > 0) {
        for (const model of config.OPENROUTER_MODELS) {
            const result = _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, model);
            if (result.success) {
                _setCachedAnswer(cacheKey, result.text);
                _logAIUsage(result.actualModel || model, promptText, "成功", "OpenRouter");
                return showModel ? "【" + (result.actualModel || model) + "】\n" + result.text : result.text;
            }
            lastError = `OpenRouter(${model}): ${result.error}`;
            console.warn(`【OpenRouter失敗】${model}: ${result.error}`);
        }
    }

    // ============================================================
    // 3. 最終手段: OpenRouter Free
    // ============================================================
    const freeModel = config.OPENROUTER_FREE_MODEL;
    const freeResult = _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, freeModel);

    if (freeResult.success) {
        _setCachedAnswer(cacheKey, freeResult.text);
        _logAIUsage(freeResult.actualModel || freeModel, promptText, "成功(Free)", "OpenRouter");
        return showModel ? "【" + (freeResult.actualModel || freeModel) + "】\n" + freeResult.text : freeResult.text;
    }

    // 全滅
    const finalError = `【全API失敗】Last Error: ${freeResult.error}`;
    _logAIUsage("N/A", promptText, "全API失敗", "N/A");
    return finalError;
}


// ============================================================
// Gemini API 呼び出し（内部関数）
// ============================================================
function _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, model, config) {
    const API_KEY = config.GEMINI_API_KEY;
    if (!API_KEY) return { success: false, error: "GEMINI_API_KEY 未設定" };
    const URL = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + API_KEY;

    // Gemini形式の contents を構築（会話履歴・Few-shot対応）
    const contents = [];

    // Few-shot例示を会話形式で追加
    if (fewShotRange && Array.isArray(fewShotRange)) {
        fewShotRange.forEach(row => {
            if (row[0] && row[1]) {
                contents.push({ role: "user", parts: [{ text: "Ex: " + row[0] }] });
                contents.push({ role: "model", parts: [{ text: "Ans: " + row[1] }] });
            }
        });
    }

    // 会話履歴を追加
    if (historyRange && Array.isArray(historyRange)) {
        historyRange.forEach(row => {
            if (row[0]) contents.push({ role: "user", parts: [{ text: row[0].toString() }] });
            if (row[1]) contents.push({ role: "model", parts: [{ text: row[1].toString() }] });
        });
    }

    // 今回の質問
    contents.push({ role: "user", parts: [{ text: promptText }] });

    const payload = {
        contents: contents,
        generationConfig: { temperature: Number(temp), maxOutputTokens: config.MAX_TOKENS },
        system_instruction: systemInst
            ? { role: "system", parts: [{ text: systemInst }] }
            : undefined
    };

    const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    for (let attempt = 1; attempt <= config.MAX_RETRY; attempt++) {
        try {
            const response = UrlFetchApp.fetch(URL, options);
            const responseCode = response.getResponseCode();
            const responseText = response.getContentText();

            if (responseCode === 200) {
                const json = JSON.parse(responseText);
                if (json.candidates && json.candidates[0].content) {
                    const answer = json.candidates[0].content.parts[0].text.trim();
                    if (answer !== "") return { success: true, text: answer };
                }
            }

            // エラー詳細取得
            let errorMsg = "";
            try {
                const errorJson = JSON.parse(responseText);
                errorMsg = errorJson.error ? errorJson.error.message : "コード: " + responseCode;
            } catch (e) {
                errorMsg = responseText.substring(0, 200);
            }

            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(attempt * 2000);
            }

            if (attempt === config.MAX_RETRY) {
                return { success: false, error: errorMsg };
            }

        } catch (e) {
            if (attempt === config.MAX_RETRY) {
                return { success: false, error: "接続エラー: " + e.message };
            }
            Utilities.sleep(attempt * 2000);
        }
    }
    return { success: false, error: "不明なエラー" };
}


// ============================================================
// OpenRouter API 呼び出し（内部関数）
// ============================================================
function _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange, config, model) {
    if (!config.OPENROUTER_API_KEY) return { success: false, error: "OPENROUTER_API_KEY 未設定" };
    // OpenRouter形式の messages を構築
    const messages = [];
    if (systemInst) messages.push({ role: "system", content: systemInst });

    // Few-shot
    if (fewShotRange && Array.isArray(fewShotRange)) {
        fewShotRange.forEach(row => {
            if (row[0] && row[1]) {
                messages.push({ role: "user", content: "Ex: " + row[0] });
                messages.push({ role: "assistant", content: "Ans: " + row[1] });
            }
        });
    }

    // 履歴
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

    for (let attempt = 1; attempt <= config.MAX_RETRY; attempt++) {
        try {
            const response = UrlFetchApp.fetch(config.OPENROUTER_URL, options);
            const json = JSON.parse(response.getContentText());
            const statusCode = response.getResponseCode();

            if (statusCode === 200 && json.choices && json.choices[0]) {
                const answer = json.choices[0].message.content.trim();
                if (answer !== "") return { success: true, text: answer, actualModel: json.model };
            }

            const errorMsg = json.error ? json.error.message : "ステータスコード: " + statusCode;

            if (attempt < config.MAX_RETRY) {
                Utilities.sleep(attempt * 2000);
            }

            if (attempt === config.MAX_RETRY) {
                return { success: false, error: errorMsg };
            }

        } catch (e) {
            if (attempt === config.MAX_RETRY) {
                return { success: false, error: "接続エラー: " + e.toString() };
            }
            Utilities.sleep(attempt * 2000);
        }
    }
    return { success: false, error: "不明なエラー" };
}
