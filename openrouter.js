
// ============================================================
// OpenRouter AI 関数 (openrouter.js)
// ============================================================
// このファイルは、スプレッドシートから「=or_AI("質問")」で
// AIに質問できる関数を提供します。
//
// 【動作の流れ】
//  1. モデルリスト(MODELS)の上から順にAIモデルを試す
//  2. 各モデルで最大2回リトライする（リトライ不要エラーは即スキップ）
//  3. 全モデル失敗時は openrouter/free（自動選択）を最終手段として試す
//  4. それでもダメならエラーメッセージを返す
//
// 【エラー時の戻り値プレフィックス】
//  🔑APIキー未設定  → スクリプトプロパティにキーがない
//  🔑認証エラー     → APIキーが無効・期限切れ (401/403)
//  ⏳レート制限     → API呼び出し回数の上限超過 (429)
//  ❌モデル不明     → 指定モデルが存在しない (404)
//  ⚠️リクエスト不正 → パラメータに問題 (400)
//  💔サーバーエラー → API側の障害 (500/502/503)
//  🔌接続エラー     → ネットワーク障害
//  📭空回答         → APIは成功だが回答が空
//  💀全モデル失敗   → すべてのモデル・手段が失敗
//
// 【showModel=TRUE 時の表示例】
//  【meta-llama/llama-3.3-70b-instruct:free | 256tok | 2.3s】
//
// 【使い方の例】
//  =or_AI("こんにちは")                              ← 最小構成
//  =or_AI("質問","先生として回答")                    ← 役割指定
//  =or_AI("質問","先生として回答",0.5)                ← 温度(創造性)指定
//  =or_AI("質問",,,,,TRUE)                         ← モデル名表示あり(6番目)
//  =or_AI("質問","先生",0.5,,,TRUE)                 ← 設定あり + モデル名表示
// ============================================================


// ============================================================
// 1. 基本設定
// ============================================================
const AI_CONFIG = {
  API_KEY: PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY'),
  BASE_URL: 'https://openrouter.ai/api/v1/chat/completions',
  MODELS: [
    "stepfun/step-3.5-flash:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "tngtech/deepseek-r1t2-chimera:free",
    "google/gemma-3-27b-it:free",
    "nvidia/nemotron-3-nano-30b-a3b:free"
  ],
  FREE_MODEL: "openrouter/free",
  DEFAULT_MODEL: "openrouter/free",
  MAX_TOKENS: 1024,
  MAX_RETRY: 2
};


// ============================================================
// エラー分類ヘルパー（OpenRouter用）
// ============================================================
function _classifyHttpError_OR(statusCode) {
  switch (statusCode) {
    case 400: return { prefix: "【⚠️リクエスト不正】", shouldRetry: false };
    case 401: return { prefix: "【🔑認証エラー】", shouldRetry: false };
    case 403: return { prefix: "【🔑認証エラー】", shouldRetry: false };
    case 404: return { prefix: "【❌モデル不明】", shouldRetry: false };
    case 429: return { prefix: "【⏳レート制限】", shouldRetry: true };
    case 500: return { prefix: "【💔サーバーエラー】", shouldRetry: true };
    case 502: return { prefix: "【💔サーバーエラー】", shouldRetry: true };
    case 503: return { prefix: "【💔サーバーエラー】", shouldRetry: true };
    default: return { prefix: "【⚠️HTTPエラー(" + statusCode + ")】", shouldRetry: true };
  }
}


// ============================================================
// showModel 表示ヘルパー（OpenRouter用）
// ============================================================
function _formatModelHeader_OR(modelName, tokens, elapsedMs) {
  const tokStr = tokens ? tokens + "tok" : "?tok";
  const secStr = elapsedMs ? (elapsedMs / 1000).toFixed(1) + "s" : "?s";
  return "【" + modelName + " | " + tokStr + " | " + secStr + "】";
}


// ============================================================
// 2. メインの AI 関数: or_AI
// ============================================================
/**
 * カスタムAI関数: or_AI
 * モデルリストを上から順に試行し、最終手段として openrouter/free にフォールバック。
 *
 * @param {string} promptText   今回の質問 (必須)
 * @param {string} systemInst   AIの役割・ルール (任意)
 * @param {number} temp         温度 0.0〜2.0 (初期値 0.3)
 * @param {Range}  fewShotRange 例示の範囲 [入力例, 出力例] (任意)
 * @param {Range}  historyRange 過去の対話範囲 [自分, AI] (任意)
 * @param {boolean} showModel   モデル名+トークン数+応答時間を表示するか (初期値: false)
 * @customfunction
 */
function or_AI(promptText, systemInst, temp, fewShotRange, historyRange, showModel) {

  // 引数の補正処理
  systemInst = systemInst || "";
  temp = (temp === undefined || temp === null || temp === "") ? 0.3 : Number(temp);
  fewShotRange = fewShotRange || null;
  historyRange = historyRange || null;
  showModel = (showModel === true || showModel === "TRUE" || showModel === "true");

  // 入力チェック
  if (!promptText) return "【通知】質問を入力してください。";
  if (!AI_CONFIG.API_KEY) return "【🔑APIキー未設定】OPENROUTER_API_KEY をプロジェクト設定 > スクリプトプロパティで登録してください。";

  // メッセージ組み立て
  const messages = [];
  if (systemInst) messages.push({ role: "system", content: systemInst });
  if (fewShotRange && Array.isArray(fewShotRange)) {
    fewShotRange.forEach(row => {
      if (row[0] && row[1]) {
        messages.push({ role: "user", content: "Ex: " + row[0] });
        messages.push({ role: "assistant", content: "Ans: " + row[1] });
      }
    });
  }
  if (historyRange && Array.isArray(historyRange)) {
    historyRange.forEach(row => {
      if (row[0]) messages.push({ role: "user", content: row[0].toString() });
      if (row[1]) messages.push({ role: "assistant", content: row[1].toString() });
    });
  }
  messages.push({ role: "user", content: promptText });

  // 試行結果を記録する配列（最終エラーサマリー用）
  const trialLog = [];



  // 【パターンB】リストの上から順番に試す
  for (const model of AI_CONFIG.MODELS) {
    const result = _tryModel(model, messages, temp);
    if (result.success) {
      const displayModel = result.actualModel || model;
      return showModel ? _formatModelHeader_OR(displayModel, result.tokens, result.elapsedMs) + "\n" + result.text : result.text;
    }
    trialLog.push(`${model}: ${result.errorDetail}`);
    console.warn(`【失敗】${model}: ${result.errorDetail}`);
  }

  // 【パターンC】最終手段 openrouter/free
  const freeResult = _tryModel(AI_CONFIG.FREE_MODEL, messages, temp);
  if (freeResult.success) {
    const displayModel = freeResult.actualModel || AI_CONFIG.FREE_MODEL;
    return showModel ? _formatModelHeader_OR(displayModel, freeResult.tokens, freeResult.elapsedMs) + "\n" + freeResult.text : freeResult.text;
  }
  trialLog.push(`Free: ${freeResult.errorDetail}`);

  // 全滅 → 試行結果のサマリーを返す
  return "【💀全モデル失敗】\n" + trialLog.join("\n");
}


// ============================================================
// 3. 内部関数: _tryModel
// ============================================================
// 指定された1つのモデルに対し、最大MAX_RETRY回のリトライ付きで試行。
// リトライ不要なエラー（認証/モデル不明/リクエスト不正）は即リターン。
//
// 戻り値:
//   成功時: { success: true, text: "回答", actualModel: "モデル名", elapsedMs: 数値, tokens: 数値 }
//   失敗時: { success: false, errorDetail: "分類済みエラー文" }
// ============================================================
function _tryModel(model, messages, temp) {
  const payload = {
    model: model,
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

  let lastErrorDetail = "";

  for (let attempt = 1; attempt <= AI_CONFIG.MAX_RETRY; attempt++) {
    const startTime = Date.now();
    try {
      const response = UrlFetchApp.fetch(AI_CONFIG.BASE_URL, options);
      const elapsedMs = Date.now() - startTime;
      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();

      // -- 成功 (200) --
      if (statusCode === 200) {
        let json;
        try { json = JSON.parse(responseText); } catch (e) {
          lastErrorDetail = "【⚠️リクエスト不正】レスポンスJSON解析失敗: " + responseText.substring(0, 100);
          if (attempt < AI_CONFIG.MAX_RETRY) { Utilities.sleep(1000); }
          continue;
        }
        // OpenRouterのトークン数を取得
        const tokens = (json.usage && json.usage.total_tokens) || 0;
        if (json.choices && json.choices[0] && json.choices[0].message) {
          const answer = json.choices[0].message.content.trim();
          if (answer !== "") {
            return { success: true, text: answer, actualModel: json.model, elapsedMs: elapsedMs, tokens: tokens };
          }
          lastErrorDetail = "【📭空回答】モデルが空の回答を返しました";
          if (attempt < AI_CONFIG.MAX_RETRY) { Utilities.sleep(1000); }
          continue;
        }
        lastErrorDetail = "【📭空回答】回答データの構造が不正です";
        if (attempt < AI_CONFIG.MAX_RETRY) { Utilities.sleep(1000); }
        continue;
      }

      // -- エラー応答 --
      const classification = _classifyHttpError_OR(statusCode);
      let apiMsg = "";
      try {
        const errorJson = JSON.parse(responseText);
        apiMsg = errorJson.error ? errorJson.error.message : "";
      } catch (e) {
        apiMsg = responseText.substring(0, 150);
      }
      lastErrorDetail = classification.prefix + apiMsg;

      // リトライ不要のエラー → 即リターン（次のモデルへ進む）
      if (!classification.shouldRetry) {
        return { success: false, errorDetail: lastErrorDetail };
      }

      if (attempt < AI_CONFIG.MAX_RETRY) {
        Utilities.sleep(1000);
      }

    } catch (e) {
      lastErrorDetail = "【🔌接続エラー】" + e.toString();
      if (attempt < AI_CONFIG.MAX_RETRY) {
        Utilities.sleep(1000);
      }
    }
  }

  return { success: false, errorDetail: lastErrorDetail };

}

// Last Updated: 2026-02-11