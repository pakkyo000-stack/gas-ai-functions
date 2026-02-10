// ============================================================
// ハイブリッドAI関数
// Gemini API を優先し、エラー時に OpenRouter 無料枠へフォールバック
// ============================================================

const HYBRID_CONFIG = {
    GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
    GEMINI_MODEL: "gemini-3-flash-preview",
    OPENROUTER_API_KEY: PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY'),
    OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',
    OPENROUTER_MODEL: "openrouter/free",
    MAX_TOKENS: 1024,
    MAX_RETRY: 2  // 各API側のリトライ回数
};

/**
 * ハイブリッドAI関数: AI
 * Gemini API を優先して呼び出し、失敗時に OpenRouter 無料枠へ自動フォールバック。
 * スプレッドシートから直接呼び出し可能。
 * @param {string} promptText 今回の質問 (必須)
 * @param {string} systemInst AIの役割・ルール (任意)
 * @param {number} temp 温度感 0.0-2.0 (初期値 0.3)
 * @param {Range} fewShotRange 例示の範囲 [入力例, 出力例] (任意)
 * @param {Range} historyRange 過去の対話範囲 [自分, AI] (任意)
 * @param {string} geminiModel Geminiモデル名 (初期値: gemini-3-flash-preview)
 * @customfunction
 */
function AI(promptText, systemInst = "", temp = 0.3, fewShotRange = null, historyRange = null, geminiModel = HYBRID_CONFIG.GEMINI_MODEL) {

    if (!promptText) return "【通知】質問を入力してください。";

    // ============================================================
    // 1. Gemini API で試行
    // ============================================================
    const geminiResult = _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, geminiModel);

    if (geminiResult.success) {
        return geminiResult.text;
    }

    // Gemini失敗時のログ
    console.warn("【Gemini失敗】" + geminiResult.error + " → OpenRouterへフォールバック");

    // ============================================================
    // 2. OpenRouter 無料枠へフォールバック
    // ============================================================
    const orResult = _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange);

    if (orResult.success) {
        return orResult.text;
    }

    // 両方失敗
    return `【全API失敗】Gemini: ${geminiResult.error} / OpenRouter: ${orResult.error}`;
}


// ============================================================
// Gemini API 呼び出し（内部関数）
// ============================================================
function _callGemini(promptText, systemInst, temp, fewShotRange, historyRange, model) {
    const API_KEY = HYBRID_CONFIG.GEMINI_API_KEY;
    const URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

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
        generationConfig: { temperature: temp, maxOutputTokens: HYBRID_CONFIG.MAX_TOKENS },
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

    for (let attempt = 1; attempt <= HYBRID_CONFIG.MAX_RETRY; attempt++) {
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

            if (attempt < HYBRID_CONFIG.MAX_RETRY) {
                Utilities.sleep(attempt * 1000);
            }

            if (attempt === HYBRID_CONFIG.MAX_RETRY) {
                return { success: false, error: errorMsg };
            }

        } catch (e) {
            if (attempt === HYBRID_CONFIG.MAX_RETRY) {
                return { success: false, error: "接続エラー: " + e.message };
            }
            Utilities.sleep(attempt * 1000);
        }
    }
    return { success: false, error: "不明なエラー" };
}


// ============================================================
// OpenRouter API 呼び出し（内部関数）
// ============================================================
function _callOpenRouter(promptText, systemInst, temp, fewShotRange, historyRange) {
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
        model: HYBRID_CONFIG.OPENROUTER_MODEL,
        messages: messages,
        temperature: temp,
        max_tokens: HYBRID_CONFIG.MAX_TOKENS
    };

    const options = {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": "Bearer " + HYBRID_CONFIG.OPENROUTER_API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    for (let attempt = 1; attempt <= HYBRID_CONFIG.MAX_RETRY; attempt++) {
        try {
            const response = UrlFetchApp.fetch(HYBRID_CONFIG.OPENROUTER_URL, options);
            const json = JSON.parse(response.getContentText());
            const statusCode = response.getResponseCode();

            if (statusCode === 200 && json.choices && json.choices[0]) {
                const answer = json.choices[0].message.content.trim();
                if (answer !== "") return { success: true, text: answer };
            }

            const errorMsg = json.error ? json.error.message : "ステータスコード: " + statusCode;

            if (attempt < HYBRID_CONFIG.MAX_RETRY) {
                Utilities.sleep(attempt * 1000);
            }

            if (attempt === HYBRID_CONFIG.MAX_RETRY) {
                return { success: false, error: errorMsg };
            }

        } catch (e) {
            if (attempt === HYBRID_CONFIG.MAX_RETRY) {
                return { success: false, error: "接続エラー: " + e.toString() };
            }
            Utilities.sleep(attempt * 1000);
        }
    }
    return { success: false, error: "不明なエラー" };
}
