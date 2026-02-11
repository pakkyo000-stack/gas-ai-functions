// ============================================================
// AI 便利ツール関数 (ai_tools.js)
// ============================================================
// このファイルは、hy_AI をベースにした便利なショートカット関数群です。
// どの関数も内部で hy_AI（hybrid_ai.js）を呼び出しています。
//
// 【提供する関数一覧】
//  - translateAI : テキスト翻訳
//  - hy_AI_JSON  : JSON形式で回答取得
//  - batchAI     : 複数データの一括処理
//  - formatAI    : 出力形式(リスト/表/短文/詳細)を指定
//  - summarizeAI : テキスト要約
//
// 【使い方の例（スプレッドシートから）】
//  =translateAI("Hello World")              ← 英語→日本語に翻訳
//  =translateAI("こんにちは","en")           ← 日本語→英語に翻訳
//  =summarizeAI(A1, 100)                    ← A1セルの内容を100文字に要約
//  =batchAI(A1:A10, "カテゴリ分け")         ← A1〜A10を一括でカテゴリ分け
//  =formatAI("AIとは","short")              ← 50文字以内で簡潔に回答
// ============================================================


// ============================================================
// 1. 翻訳関数: translateAI
// ============================================================
// テキストを指定した言語に翻訳する。
// デフォルトは日本語訳。翻訳元言語は自動検出。
// ============================================================
/**
 * テキストを指定言語に翻訳します。
 *
 * @param {string} text       翻訳するテキスト (必須)
 * @param {string} targetLang 翻訳先の言語コード (初期値: "ja" 日本語)
 *                            使える言語: ja, en, zh, ko, fr, de, es, pt, it, ru, ar, th, vi
 * @param {string} sourceLang 翻訳元の言語コード (初期値: "" 自動検出)
 * @customfunction
 */
function translateAI(text, targetLang = "ja", sourceLang = "") {
    if (!text) return "【通知】翻訳するテキストを入力してください。";

    // 言語コードと日本語名の対応表
    const langMap = {
        "ja": "日本語", "en": "英語", "zh": "中国語", "ko": "韓国語",
        "fr": "フランス語", "de": "ドイツ語", "es": "スペイン語",
        "pt": "ポルトガル語", "it": "イタリア語", "ru": "ロシア語",
        "ar": "アラビア語", "th": "タイ語", "vi": "ベトナム語"
    };

    // 言語コードを日本語名に変換（対応表にない場合はコードそのまま）
    const targetName = langMap[targetLang] || targetLang;
    const sourceHint = sourceLang ? `（翻訳元: ${langMap[sourceLang] || sourceLang}）` : "";

    // AIに翻訳を依頼するシステム指示を作成
    const systemInst = `あなたは正確で自然な翻訳者です。入力されたテキストを${targetName}に翻訳してください${sourceHint}。翻訳結果のみを出力し、説明や補足は不要です。`;

    // 温度を低め(0.1)に設定して正確な翻訳を促す
    return hy_AI(text, systemInst, 0.1);
}


// ============================================================
// 2. JSON出力関数: hy_AI_JSON
// ============================================================
// AIの回答をJSON形式で取得する。
// データ構造化やAPI連携用途に便利。
// ============================================================
/**
 * AIの回答をJSON形式で取得します。
 *
 * @param {string} promptText 質問・指示 (必須)
 *                           例: "日本の都道府県をJSON配列で出力して"
 * @param {string} systemInst 追加のシステム指示 (任意)
 * @customfunction
 */
function hy_AI_JSON(promptText, systemInst = "") {
    if (!promptText) return "【通知】質問を入力してください。";

    // JSON形式で回答するようシステム指示に追加
    const jsonSystemInst = (systemInst ? systemInst + "\n\n" : "") +
        "回答は必ず有効なJSON形式のみで出力してください。マークダウンのコードブロック（```）は使わないでください。説明文やコメントは含めないでください。";

    // 温度を低め(0.2)に設定して正確なJSON出力を促す
    const result = hy_AI(promptText, jsonSystemInst, 0.2);

    // ----------------------------------------------------------
    // JSON文字列のクリーニング
    // ----------------------------------------------------------
    // AIが ```json ... ``` で囲んで返してくることがあるため、除去する
    let cleaned = result.trim();
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    return cleaned;
}


// ============================================================
// 3. バッチ処理関数: batchAI
// ============================================================
// 複数セルの内容をまとめてAIに送り、一括処理する。
// 1セルずつ呼ぶよりも効率的（API呼び出し回数を節約）。
// ============================================================
/**
 * 複数セルの内容をまとめてAIに送り、一括処理します。
 *
 * @param {Range}  dataRange   処理するデータの範囲 (必須) 例: A1:A10
 * @param {string} instruction 各項目に対する指示 (必須) 例: "英語に翻訳して"
 * @param {string} systemInst  システム指示 (任意)
 * @customfunction
 */
function batchAI(dataRange, instruction, systemInst = "") {
    if (!dataRange || !instruction) return "【通知】データ範囲と指示を入力してください。";

    // 範囲データを1次元配列に変換し、空セルを除外
    const items = Array.isArray(dataRange)
        ? dataRange.flat().filter(cell => cell !== "")
        : [dataRange];

    if (items.length === 0) return "【通知】データが空です。";

    // 各データに番号を振ってリスト化
    const numberedList = items.map((item, i) => `${i + 1}. ${item}`).join("\n");

    // AIへの指示文を組み立て
    const batchPrompt = `以下の${items.length}件のデータに対して、それぞれ「${instruction}」を実行してください。
結果は番号付きリストで、入力と同じ順番で出力してください。

---
${numberedList}`;

    return hy_AI(batchPrompt, systemInst, 0.3);
}


// ============================================================
// 4. フォーマット指定関数: formatAI
// ============================================================
// 出力形式（リスト・表・短文・詳細）を指定してAIに質問する。
// 用途に応じて最適な形式で回答を得られる。
// ============================================================
/**
 * 出力形式を指定してAIに質問します。
 *
 * @param {string} promptText 質問 (必須)
 * @param {string} format     出力形式 (初期値: "list")
 *                            "list"   → 箇条書き
 *                            "table"  → 表形式
 *                            "short"  → 50文字以内
 *                            "detail" → 詳細説明
 * @param {string} systemInst 追加のシステム指示 (任意)
 * @customfunction
 */
function formatAI(promptText, format = "list", systemInst = "") {
    if (!promptText) return "【通知】質問を入力してください。";

    // フォーマットごとのAI向け指示文
    const formatInstructions = {
        "list": "回答は箇条書き（リスト形式）で簡潔にまとめてください。",
        "table": "回答は表形式（ヘッダー行 + データ行）で出力してください。区切り文字にはタブを使用してください。",
        "short": "回答は50文字以内で簡潔に要点のみ答えてください。",
        "detail": "回答は詳細に、背景や理由も含めて丁寧に説明してください。"
    };

    // 指定されたフォーマットに対応する指示を取得（不明な場合はリスト形式）
    const formatHint = formatInstructions[format] || formatInstructions["list"];

    // ユーザーのシステム指示 + フォーマット指示を合成
    const fullSystemInst = (systemInst ? systemInst + "\n\n" : "") + formatHint;

    return hy_AI(promptText, fullSystemInst, 0.3);
}


// ============================================================
// 5. 要約関数: summarizeAI
// ============================================================
// 長いテキストを指定文字数以内に要約する。
// ============================================================
/**
 * テキストを要約します。
 *
 * @param {string} text     要約するテキスト (必須)
 * @param {number} maxChars 最大文字数 (初期値: 200)
 * @customfunction
 */
function summarizeAI(text, maxChars = 200) {
    if (!text) return "【通知】要約するテキストを入力してください。";

    // 要約の専門家として、指定文字数以内に要約を依頼
    const systemInst = `あなたは要約の専門家です。入力されたテキストを${maxChars}文字以内で要約してください。要約のみを出力し、前置きや補足は不要です。`;

    // 温度を低め(0.2)に設定して正確な要約を促す
    return hy_AI(text, systemInst, 0.2);
}

// Last Updated: 2026-02-11
