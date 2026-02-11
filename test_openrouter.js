// ============================================================
// OpenRouter テスト関数
// GASスクリプトエディタから手動実行してログで確認
// ============================================================

/**
 * 最小限のOpenRouter API呼び出し（デバッグ用）
 * モデル名とAPIキーの状態をログ出力する
 */
function testOpenRouterSimple() {
    const API_KEY = PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY');

    // APIキー確認
    if (!API_KEY) {
        Logger.log("❌ OPENROUTER_API_KEY が PropertiesService に未設定です");
        return;
    }
    Logger.log("✅ APIキー取得OK (先頭10文字): " + API_KEY.substring(0, 10) + "...");

    const model = "openrouter/free";
    const url = "https://openrouter.ai/api/v1/chat/completions";

    const payload = {
        model: model,
        messages: [
            { role: "user", content: "Hello, say OK" }
        ],
        temperature: 0.3,
        max_tokens: 50
    };

    const options = {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": "Bearer " + API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    Logger.log("📤 リクエスト送信: model=" + model);
    Logger.log("📤 payload: " + JSON.stringify(payload));

    try {
        const response = UrlFetchApp.fetch(url, options);
        const statusCode = response.getResponseCode();
        const body = response.getContentText();

        Logger.log("📥 ステータスコード: " + statusCode);
        Logger.log("📥 レスポンス: " + body);

        if (statusCode === 200) {
            const json = JSON.parse(body);
            if (json.choices && json.choices[0]) {
                Logger.log("✅ 成功！回答: " + json.choices[0].message.content);
                Logger.log("✅ 使用モデル: " + (json.model || "不明"));
            } else {
                Logger.log("⚠️ 200だが choices が空");
            }
        } else {
            Logger.log("❌ エラー: " + body);
        }
    } catch (e) {
        Logger.log("❌ 接続エラー: " + e.toString());
    }
}


/**
 * 複数モデルを順番にテスト
 * どのモデルが使えるか確認する
 */
function testOpenRouterModels() {
    const API_KEY = PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY');

    if (!API_KEY) {
        Logger.log("❌ OPENROUTER_API_KEY 未設定");
        return;
    }

    const models = [
        "openrouter/free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "meta-llama/llama-3.2-3b-instruct:free",
        "arcee-ai/trinity-large-preview:free",
        "nvidia/nemotron-3-nano-30b-a3b:free",
        "tngtech/deepseek-r1t2-chimera:free"
    ];

    const url = "https://openrouter.ai/api/v1/chat/completions";

    for (const model of models) {
        Logger.log("-----------------------------------");
        Logger.log("🔄 テスト中: " + model);

        const payload = {
            model: model,
            messages: [{ role: "user", content: "Say OK" }],
            temperature: 0.3,
            max_tokens: 20
        };

        const options = {
            method: "post",
            contentType: "application/json",
            headers: { "Authorization": "Bearer " + API_KEY },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        };

        try {
            const response = UrlFetchApp.fetch(url, options);
            const statusCode = response.getResponseCode();
            const body = response.getContentText();

            if (statusCode === 200) {
                const json = JSON.parse(body);
                if (json.choices && json.choices[0]) {
                    Logger.log("✅ " + model + " → 成功: " + json.choices[0].message.content.trim());
                } else {
                    Logger.log("⚠️ " + model + " → 200だがchoices空");
                }
            } else {
                const json = JSON.parse(body);
                const errMsg = json.error ? json.error.message : body.substring(0, 100);
                Logger.log("❌ " + model + " → コード" + statusCode + ": " + errMsg);
            }
        } catch (e) {
            Logger.log("❌ " + model + " → 接続エラー: " + e.toString());
        }

        // モデル間に1秒待機
        Utilities.sleep(1000);
    }

    Logger.log("===================================");
    Logger.log("テスト完了");
}


/**
 * GeminiのAPIキー存在確認テスト
 */
function testApiKeys() {
    const props = PropertiesService.getScriptProperties();

    const geminiKey = props.getProperty('GEMINI_API_KEY');
    const orKey = props.getProperty('OPENROUTER_API_KEY');

    Logger.log("=== APIキー確認 ===");
    Logger.log("GEMINI_API_KEY: " + (geminiKey ? "✅ 設定済み (" + geminiKey.substring(0, 10) + "...)" : "❌ 未設定"));
    Logger.log("OPENROUTER_API_KEY: " + (orKey ? "✅ 設定済み (" + orKey.substring(0, 10) + "...)" : "❌ 未設定"));
}
