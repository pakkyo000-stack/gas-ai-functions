// ============================================================
// AI ユーティリティ関数 (ai_utils.js)
// ============================================================
// このファイルは、他のAI関数から共通で使われる
// 「裏方」の補助関数をまとめたものです。
//
// 【提供する機能】
//  1. キャッシュ管理 → 同じ質問の再利用で高速化＆API節約
//  2. 使用ログ      → AI呼び出しの記録（デバッグ・分析用）
//
// 【ログシート「AI_Log」の列構成】
//  A: 日時  B: モデル  C: ソース  D: ステータス
//  E: 応答時間(ms)  F: トークン数  G: プロンプト（100文字）
//
// 【注意点】
//  カスタム関数(@customfunction)からはシートを直接編集できないため、
//  ログは一旦 PropertiesService にバッファリングし、
//  flushAILog() を手動実行してシートに書き出す設計にしています。
// ============================================================


// ============================================================
// 1. キャッシュ管理
// ============================================================
// GAS の CacheService を使って、AI の回答を一時保存する。
// 同じ質問が来たときに API を呼ばずに即座に回答を返せる。
// 有効期限: 6時間（21600秒）
// ============================================================

/**
 * キャッシュからAI回答を取得
 *
 * @param {string} key キャッシュキー（質問のMD5ハッシュ）
 * @return {string|null} キャッシュされた回答（なければnull）
 */
function _getCachedAnswer(key) {
    try {
        const cache = CacheService.getScriptCache();
        return cache.get(key);  // キーが存在しなければ null が返る
    } catch (e) {
        // キャッシュの取得に失敗しても、メイン処理に影響させない
        return null;
    }
}

/**
 * AI回答をキャッシュに保存（有効期限: 6時間）
 *
 * @param {string} key   キャッシュキー（質問のMD5ハッシュ）
 * @param {string} value 回答テキスト
 */
function _setCachedAnswer(key, value) {
    try {
        const cache = CacheService.getScriptCache();
        // CacheService の制限:
        //  - 1エントリの最大サイズ: 100KB
        //  - 最大有効期間: 21600秒（6時間）
        if (value.length < 100000) {
            cache.put(key, value, 21600);
        }
        // 100KB超の回答はキャッシュしない（まれなケース）
    } catch (e) {
        console.warn("キャッシュ保存失敗: " + e.message);
    }
}

/**
 * キャッシュキーを生成
 * 質問文 + システム指示 + 温度 を結合して MD5 ハッシュを計算する。
 * 同じ組み合わせなら同じキーが生成されるため、キャッシュヒットする。
 *
 * @param {string} prompt     質問文
 * @param {string} systemInst システム指示
 * @param {number} temp       温度
 * @return {string} MD5ハッシュ文字列（32文字の16進数）
 */
function _makeCacheKey(prompt, systemInst, temp) {
    // 入力を "|" で区切って1つの文字列にする
    const raw = prompt + "|" + systemInst + "|" + temp;

    // MD5ハッシュを計算し、16進数文字列に変換
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
        .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2))
        .join('');
}

/**
 * AIキャッシュを全クリア
 * スクリプトエディタや GAS メニューから手動実行してください。
 * キャッシュが古くなった場合や、動作確認時に使います。
 */
function clearAICache() {
    CacheService.getScriptCache().removeAll([]);
    Logger.log("AIキャッシュをクリアしました");
}


// ============================================================
// 2. 使用ログ（応答時間・トークン数対応版）
// ============================================================
// AI 関数が呼ばれるたびに、使用モデル・質問・結果・応答時間・
// トークン数を記録する。
//
// 【なぜ PropertiesService にバッファリングするのか？】
//  GAS のカスタム関数（@customfunction）からは SpreadsheetApp の
//  書き込み操作ができない（セキュリティ制限）。
//  そのため、まず PropertiesService に JSON で一時保存（バッファ）し、
//  後から flushAILog() を手動実行してシートに一括書き出しする。
// ============================================================

/** ログシートのヘッダー定義（7列） */
const LOG_HEADERS = ["日時", "モデル", "ソース", "ステータス", "応答時間(ms)", "トークン数", "プロンプト（100文字）"];

/**
 * AI使用ログを記録（バッファに追加）
 * カスタム関数からでも安全に呼び出せる。
 *
 * @param {string} model     使用モデル名 (例: "gemini-2.0-flash-preview")
 * @param {string} prompt    質問テキスト（先頭100文字のみ保存）
 * @param {string} status    結果 ("成功" / "全API失敗" など)
 * @param {string} source    ソース ("Gemini" / "OpenRouter" / "N/A")
 * @param {number} elapsedMs 応答時間（ミリ秒）。不明なら 0
 * @param {number} tokens    使用トークン数。不明なら 0
 */
function _logAIUsage(model, prompt, status, source, elapsedMs, tokens) {
    try {
        // ログエントリを JSON 文字列として作成
        const entry = JSON.stringify({
            date: new Date().toISOString(),       // 日時（ISO形式）
            model: model,                          // モデル名
            source: source,                        // API種別
            status: status,                        // 成功/失敗
            elapsedMs: elapsedMs || 0,             // 応答時間(ms)
            tokens: tokens || 0,                   // トークン数
            prompt: prompt.substring(0, 100)       // 質問（先頭100文字）
        });

        // 既存のバッファを読み込み
        const props = PropertiesService.getScriptProperties();
        const existing = props.getProperty('AI_LOG_BUFFER') || '[]';
        const buffer = JSON.parse(existing);

        // 新しいエントリを追加
        buffer.push(entry);

        // バッファ上限: 最新100件を保持（古いものを削除）
        if (buffer.length > 100) buffer.splice(0, buffer.length - 100);

        // バッファを保存
        props.setProperty('AI_LOG_BUFFER', JSON.stringify(buffer));

    } catch (e) {
        // ログ保存が失敗しても、メイン処理に影響させない（黙殺）
        console.log("ログバッファ保存: " + model + " / " + status);
    }
}

/**
 * バッファに溜まったAIログをシートに一括書き出し
 *
 * 【使い方】
 *  スクリプトエディタから手動で実行してください。
 *  「AI_Log」シートが自動作成され、ログデータが追記されます。
 */
function flushAILog() {
    const props = PropertiesService.getScriptProperties();
    const existing = props.getProperty('AI_LOG_BUFFER') || '[]';
    const buffer = JSON.parse(existing);

    // バッファが空なら何もしない
    if (buffer.length === 0) {
        Logger.log("書き出すログはありません。");
        return;
    }

    // ----------------------------------------------------------
    // 「AI_Log」シートを取得（なければ新規作成）
    // ----------------------------------------------------------
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName("AI_Log");

    if (!logSheet) {
        // シートを新規作成してヘッダー行を設定
        logSheet = ss.insertSheet("AI_Log");
        logSheet.getRange(1, 1, 1, LOG_HEADERS.length)
            .setValues([LOG_HEADERS])
            .setFontWeight("bold")
            .setBackground("#f3f3f3");
        logSheet.setColumnWidth(1, 160);   // 日時列を広めに
        logSheet.setColumnWidth(7, 400);   // プロンプト列を広めに
    }

    // ----------------------------------------------------------
    // バッファのデータを2次元配列に変換（7列）
    // ----------------------------------------------------------
    const rows = buffer.map(raw => {
        const e = JSON.parse(raw);
        return [e.date, e.model, e.source, e.status, e.elapsedMs || 0, e.tokens || 0, e.prompt];
    });

    // ----------------------------------------------------------
    // シートの最終行の次から書き込み（追記）
    // ----------------------------------------------------------
    const lastRow = logSheet.getLastRow();
    logSheet.getRange(lastRow + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);

    // バッファをクリア（書き出し済み）
    props.setProperty('AI_LOG_BUFFER', '[]');
    Logger.log(rows.length + " 件のログをシートに書き出しました。");
}

/**
 * AI使用ログシートを初期化（データ削除）
 *
 * 【使い方】
 *  スクリプトエディタから手動で実行してください。
 *  「AI_Log」シートの内容がクリアされ、ヘッダー行が再設定されます。
 *  同時にバッファもクリアされます。
 */
function clearAILog() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName("AI_Log");

    if (logSheet) {
        // シートの内容をクリアしてヘッダー行を再設定
        logSheet.clear();
        logSheet.getRange(1, 1, 1, LOG_HEADERS.length)
            .setValues([LOG_HEADERS])
            .setFontWeight("bold")
            .setBackground("#f3f3f3");
    }

    // PropertiesService のバッファもクリア
    PropertiesService.getScriptProperties().setProperty('AI_LOG_BUFFER', '[]');
    Logger.log("AI使用ログをクリアしました");
}
