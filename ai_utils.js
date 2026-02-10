// ============================================================
// AI ユーティリティ関数
// キャッシュ管理 + 使用ログ
// ============================================================

/**
 * キャッシュからAI回答を取得
 * @param {string} key キャッシュキー
 * @return {string|null} キャッシュされた回答（なければnull）
 */
function _getCachedAnswer(key) {
    try {
        const cache = CacheService.getScriptCache();
        return cache.get(key);
    } catch (e) {
        return null;
    }
}

/**
 * AI回答をキャッシュに保存（有効期限: 6時間）
 * @param {string} key キャッシュキー
 * @param {string} value 回答テキスト
 */
function _setCachedAnswer(key, value) {
    try {
        const cache = CacheService.getScriptCache();
        // CacheServiceの上限は100KB、6時間 = 21600秒
        if (value.length < 100000) {
            cache.put(key, value, 21600);
        }
    } catch (e) {
        console.warn("キャッシュ保存失敗: " + e.message);
    }
}

/**
 * キャッシュキーを生成（引数のハッシュ）
 * @param {string} prompt
 * @param {string} systemInst
 * @param {number} temp
 * @return {string}
 */
function _makeCacheKey(prompt, systemInst, temp) {
    const raw = prompt + "|" + systemInst + "|" + temp;
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
        .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2))
        .join('');
}

/**
 * AIキャッシュを全クリア
 * メニューやマクロから呼び出し可能
 */
function clearAICache() {
    CacheService.getScriptCache().removeAll([]);
    Logger.log("AIキャッシュをクリアしました");
}


// ============================================================
// 使用ログ
// ============================================================

/**
 * AI使用ログを記録
 * @param {string} model 使用モデル名
 * @param {string} prompt 質問（先頭100文字）
 * @param {string} status 成功/失敗
 * @param {string} source "Gemini" or "OpenRouter"
 */
function _logAIUsage(model, prompt, status, source) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let logSheet = ss.getSheetByName("AI_Log");

        if (!logSheet) {
            logSheet = ss.insertSheet("AI_Log");
            logSheet.getRange(1, 1, 1, 5)
                .setValues([["日時", "モデル", "ソース", "ステータス", "プロンプト（100文字）"]])
                .setFontWeight("bold")
                .setBackground("#f3f3f3");
            logSheet.setColumnWidth(1, 160);
            logSheet.setColumnWidth(5, 400);
        }

        logSheet.appendRow([
            new Date(),
            model,
            source,
            status,
            prompt.substring(0, 100)
        ]);
    } catch (e) {
        // ログ記録の失敗は無視（メイン処理に影響させない）
        console.warn("ログ記録失敗: " + e.message);
    }
}

/**
 * AI使用ログシートを初期化（データ削除）
 */
function clearAILog() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName("AI_Log");
    if (logSheet) {
        logSheet.clear();
        logSheet.getRange(1, 1, 1, 5)
            .setValues([["日時", "モデル", "ソース", "ステータス", "プロンプト（100文字）"]])
            .setFontWeight("bold")
            .setBackground("#f3f3f3");
        Logger.log("AI使用ログをクリアしました");
    }
}
