/**
 * Gemini API 統合関数
 * gemini.js と gemini2.js を統合。gemn2 のエラーハンドリングをベースに、モデルを引数で切り替え可能。
 */

// ============================================================
// テスト関数
// ============================================================
function testgemini() {
  var result = gemn(
    "【post】【response】",
    "あなたは世界一優秀な日本語と英語の講師です。【】で区切られた英単語を使用した英文とその日本語訳と文法の解説をしてください"
  );
  Logger.log("FINAL OUTPUT: " + result);
}

// ============================================================
// メイン関数
// ============================================================

/**
 * Gemini APIを呼び出してテキスト回答を取得する
 * @param {string} promptText   ユーザーのプロンプト（必須）
 * @param {string} systemInstruction  システム指示（任意）
 * @param {string} model        モデル名（初期値: gemini-2.5-flash）
 * @return {string} AIの回答テキスト
 */
function gemn(promptText, systemInstruction = "", model = "gemini-3-flash-preview") {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    system_instruction: systemInstruction
      ? { role: "system", parts: [{ text: systemInstruction }] }
      : undefined
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    // 成功（200）の場合
    if (responseCode === 200) {
      const json = JSON.parse(responseText);
      if (json.candidates && json.candidates[0].content) {
        return json.candidates[0].content.parts[0].text;
      }
      return "エラー：回答の構造が空です。";
    }

    // 失敗（429や400など）の場合
    let errorMsg = "";
    try {
      const errorJson = JSON.parse(responseText);
      errorMsg = errorJson.error.message;
    } catch (e) {
      errorMsg = responseText;
    }

    return `【APIエラー】コード: ${responseCode} / 内容: ${errorMsg}`;

  } catch (e) {
    return `【実行エラー】${e.message}`;
  }
}
