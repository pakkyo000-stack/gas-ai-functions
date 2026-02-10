// ============================================================
// AI 便利ツール関数
// 翻訳・バッチ処理・JSON出力・フォーマット指定
// ============================================================


/**
 * 翻訳関数: translateAI
 * テキストを指定言語に翻訳します。
 * @param {string} text 翻訳するテキスト (必須)
 * @param {string} targetLang 翻訳先の言語 (初期値: "ja" 日本語)
 * @param {string} sourceLang 翻訳元の言語 (初期値: "" 自動検出)
 * @customfunction
 */
function translateAI(text, targetLang = "ja", sourceLang = "") {
    if (!text) return "【通知】翻訳するテキストを入力してください。";

    const langMap = {
        "ja": "日本語", "en": "英語", "zh": "中国語", "ko": "韓国語",
        "fr": "フランス語", "de": "ドイツ語", "es": "スペイン語",
        "pt": "ポルトガル語", "it": "イタリア語", "ru": "ロシア語",
        "ar": "アラビア語", "th": "タイ語", "vi": "ベトナム語"
    };

    const targetName = langMap[targetLang] || targetLang;
    const sourceHint = sourceLang ? `（翻訳元: ${langMap[sourceLang] || sourceLang}）` : "";

    const systemInst = `あなたは正確で自然な翻訳者です。入力されたテキストを${targetName}に翻訳してください${sourceHint}。翻訳結果のみを出力し、説明や補足は不要です。`;

    return askAI(text, systemInst, 0.1);
}


/**
 * JSON出力関数: askAI_JSON
 * AIの回答をJSON形式で取得します。
 * @param {string} promptText 質問・指示 (必須)
 * @param {string} systemInst 追加のシステム指示 (任意)
 * @customfunction
 */
function askAI_JSON(promptText, systemInst = "") {
    if (!promptText) return "【通知】質問を入力してください。";

    const jsonSystemInst = (systemInst ? systemInst + "\n\n" : "") +
        "回答は必ず有効なJSON形式のみで出力してください。マークダウンのコードブロック（```）は使わないでください。説明文やコメントは含めないでください。";

    const result = askAI(promptText, jsonSystemInst, 0.2);

    // JSON文字列のクリーニング（```json ... ``` が返ってきた場合の対策）
    let cleaned = result.trim();
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    return cleaned;
}


/**
 * バッチ処理関数: batchAI
 * 複数セルの内容をまとめてAIに送り、一括処理します。
 * @param {Range} dataRange 処理するデータの範囲 (必須)
 * @param {string} instruction 各項目に対する指示 (必須)
 * @param {string} systemInst システム指示 (任意)
 * @customfunction
 */
function batchAI(dataRange, instruction, systemInst = "") {
    if (!dataRange || !instruction) return "【通知】データ範囲と指示を入力してください。";

    // 範囲データを配列として受け取る
    const items = Array.isArray(dataRange)
        ? dataRange.flat().filter(cell => cell !== "")
        : [dataRange];

    if (items.length === 0) return "【通知】データが空です。";

    const numberedList = items.map((item, i) => `${i + 1}. ${item}`).join("\n");

    const batchPrompt = `以下の${items.length}件のデータに対して、それぞれ「${instruction}」を実行してください。
結果は番号付きリストで、入力と同じ順番で出力してください。

---
${numberedList}`;

    return askAI(batchPrompt, systemInst, 0.3);
}


/**
 * フォーマット指定関数: formatAI
 * 出力形式を指定してAIに質問します。
 * @param {string} promptText 質問 (必須)
 * @param {string} format 出力形式: "list" / "table" / "short" / "detail" (初期値: "list")
 * @param {string} systemInst 追加のシステム指示 (任意)
 * @customfunction
 */
function formatAI(promptText, format = "list", systemInst = "") {
    if (!promptText) return "【通知】質問を入力してください。";

    const formatInstructions = {
        "list": "回答は箇条書き（リスト形式）で簡潔にまとめてください。",
        "table": "回答は表形式（ヘッダー行 + データ行）で出力してください。区切り文字にはタブを使用してください。",
        "short": "回答は50文字以内で簡潔に要点のみ答えてください。",
        "detail": "回答は詳細に、背景や理由も含めて丁寧に説明してください。"
    };

    const formatHint = formatInstructions[format] || formatInstructions["list"];
    const fullSystemInst = (systemInst ? systemInst + "\n\n" : "") + formatHint;

    return askAI(promptText, fullSystemInst, 0.3);
}


/**
 * 要約関数: summarizeAI
 * テキストを要約します。
 * @param {string} text 要約するテキスト (必須)
 * @param {number} maxChars 最大文字数 (初期値: 200)
 * @customfunction
 */
function summarizeAI(text, maxChars = 200) {
    if (!text) return "【通知】要約するテキストを入力してください。";

    const systemInst = `あなたは要約の専門家です。入力されたテキストを${maxChars}文字以内で要約してください。要約のみを出力し、前置きや補足は不要です。`;

    return askAI(text, systemInst, 0.2);
}
