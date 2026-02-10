

// ============================================================
// 1. 基本設定
// ============================================================
const AI_CONFIG = {
  API_KEY: PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY'),
  BASE_URL: 'https://openrouter.ai/api/v1/chat/completions',
  DEFAULT_MODEL: "openrouter/free",
  MAX_TOKENS: 1024,
  MAX_RETRY: 3      // 空欄やエラー時に最大何回やり直すか
};

/**
 * カスタムAI関数: my_AI
 * スプレッドシートから直接AIを呼び出します。
 * AIチャット関数（エラーハンドリング強化版）
 * @param {string} promptText 今回の質問 (必須)
 * @param {string} systemInst AIの役割・ルール (任意)
 * @param {number} temp 温度感 0.0-2.0 (初期値 0.3)
 * @param {Range} fewShotRange 例示の範囲 [入力例, 出力例] (任意)
 * @param {Range} historyRange 過去の対話範囲 [自分, AI] (任意)
 * @param {string} modelId モデルID (初期値 設定値参照)
 * @param {boolean} showModel 使用されたモデル名を表示するか (初期値: false)
 * @customfunction
 */
function my_AI(promptText, systemInst = "", temp = 0.3, fewShotRange = null, historyRange = null, modelId = AI_CONFIG.DEFAULT_MODEL, showModel = false) {

  if (!promptText) return "【通知】質問を入力してください。";

  // 手紙（メッセージ）の組み立て
  const messages = [];
  if (systemInst) messages.push({ role: "system", content: systemInst });

  // 例題の追加
  if (fewShotRange && Array.isArray(fewShotRange)) {
    fewShotRange.forEach(row => {
      if (row[0] && row[1]) {
        messages.push({ role: "user", content: "Ex: " + row[0] }, { role: "assistant", content: "Ans: " + row[1] });
      }
    });
  }

  // 履歴の追加
  if (historyRange && Array.isArray(historyRange)) {
    historyRange.forEach(row => {
      if (row[0]) messages.push({ role: "user", content: row[0].toString() });
      if (row[1]) messages.push({ role: "assistant", content: row[1].toString() });
    });
  }
  messages.push({ role: "user", content: promptText });

  const payload = {
    model: modelId,
    messages: messages,
    temperature: temp,
    max_tokens: AI_CONFIG.MAX_TOKENS
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + AI_CONFIG.API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // --- 【重要】自動リトライのループ処理 ---
  let lastError = "";

  for (let attempt = 1; attempt <= AI_CONFIG.MAX_RETRY; attempt++) {
    try {
      const response = UrlFetchApp.fetch(AI_CONFIG.BASE_URL, options);
      const json = JSON.parse(response.getContentText());
      const statusCode = response.getResponseCode();

      if (statusCode === 200 && json.choices && json.choices[0]) {
        const answer = json.choices[0].message.content.trim();

        // 回答が空でなければ、そのまま結果を返して終了
        if (answer !== "") {
          return showModel ? "【" + modelId + "】\n" + answer : answer;
        }
        lastError = "AIの回答が空欄でした";
      } else {
        lastError = json.error ? json.error.message : "ステータスコード: " + statusCode;
      }

      // 失敗した場合、少し待ってから次の試行へ（1秒ずつ待機時間を増やす）
      console.warn(`試行 ${attempt} 回目失敗: ${lastError}`);
      Utilities.sleep(attempt * 1000);

    } catch (e) {
      lastError = "接続エラー: " + e.toString();
      Utilities.sleep(attempt * 1000);
    }
  }

  // すべての試行が失敗した場合
  return `【全リトライ失敗】理由: ${lastError}`;
}