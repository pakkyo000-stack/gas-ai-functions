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
// customfunction ではシート編集不可のため、PropertiesService にバッファリング
// flushAILog() を手動実行するとシートに一括書き出し
// ============================================================

/**
 * AI使用ログを記録
 * customfunction からでも動作する（PropertiesService にバッファ保存）
 * @param {string} model 使用モデル名
 * @param {string} prompt 質問（先頭100文字）
 * @param {string} status 成功/失敗
 * @param {string} source "Gemini" or "OpenRouter"
 */
function _logAIUsage(model, prompt, status, source) {
    try {
        const entry = JSON.stringify({
            date: new Date().toISOString(),
            model: model,
            source: source,
            status: status,
            prompt: prompt.substring(0, 100)
        });

        const props = PropertiesService.getScriptProperties();
        const existing = props.getProperty('AI_LOG_BUFFER') || '[]';
        const buffer = JSON.parse(existing);
        buffer.push(entry);

        // バッファ上限: 最新100件を保持
        if (buffer.length > 100) buffer.splice(0, buffer.length - 100);

        props.setProperty('AI_LOG_BUFFER', JSON.stringify(buffer));
    } catch (e) {
        // 完全に失敗しても黙殺（メイン処理に影響させない）
        console.log("ログバッファ保存: " + model + " / " + status);
    }
}

/**
 * バッファに溜まったAIログをシートに一括書き出し
 * メニューやマクロから手動実行してください。
 */
function flushAILog() {
    const props = PropertiesService.getScriptProperties();
    const existing = props.getProperty('AI_LOG_BUFFER') || '[]';
    const buffer = JSON.parse(existing);

    if (buffer.length === 0) {
        Logger.log("書き出すログはありません。");
        return;
    }

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

    // バッファからシートに書き出し
    const rows = buffer.map(raw => {
        const e = JSON.parse(raw);
        return [e.date, e.model, e.source, e.status, e.prompt];
    });

    const lastRow = logSheet.getLastRow();
    logSheet.getRange(lastRow + 1, 1, rows.length, 5).setValues(rows);

    // バッファをクリア
    props.setProperty('AI_LOG_BUFFER', '[]');
    Logger.log(rows.length + " 件のログをシートに書き出しました。");
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
    }
    // バッファもクリア
    PropertiesService.getScriptProperties().setProperty('AI_LOG_BUFFER', '[]');
    Logger.log("AI使用ログをクリアしました");
}
