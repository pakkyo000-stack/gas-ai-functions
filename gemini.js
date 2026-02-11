// ============================================================
// Gemini API 単体関数 (gemini.js)
// ============================================================
// このファイルは、Google の Gemini API だけを使って
// AIに質問する「gemn」関数を提供します。
//
// 【動作の流れ】
//  1. 指定されたモデル（またはデフォルト）を最初に試す
//  2. 失敗したら、定義されたフォールバックリスト順に他のGeminiモデルを試す
//  3. 各モデルで最大2回リトライ（GAS 30秒制限対策）
//  4. 全モデル失敗でエラーを返す
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
//  💀全API失敗      → すべてのモデルが失敗
//
// 【使い方の例（スプレッドシートから）】
//  =gemn("こんにちは")                              ← 最小構成
//  =gemn("質問","役割を指定")                       ← システム指示付き
//  =gemn("質問","","gemini-2.0-flash")             ← モデル指定
// ============================================================

/** リトライ回数 (GAS 30秒制限を考慮して2回に制限) */
const GEMN_MAX_RETRY = 2;

/** フォールバック用モデルリスト（優先順位順） */
const GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite"
];

// ============================================================
// テスト関数（スクリプトエディタから実行して動作確認用）
// ============================================================
function testgemini() {
  var result = gemn(
    "【post】【response】",
    "あなたは世界一優秀な日本語と英語の講師です。【】で区切られた英単語を使用した英文とその日本語訳と文法の解説をしてください"
  );
  Logger.log("FINAL OUTPUT: " + result);
}

// ============================================================
// エラー分類ヘルパー（Gemini用）
// ============================================================
function _classifyHttpError_Gemini(statusCode) {
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
// メイン関数: gemn（フォールバック付き）
// ============================================================
/**
 * Gemini API を呼び出してテキスト回答を取得する
 * 指定モデル → フォールバックリストの順に試行
 *
 * @param {string} promptText        ユーザーのプロンプト（必須）
 * @param {string} systemInstruction システム指示（任意）
 * @param {string} primaryModel      最初に試すモデル名（初期値: gemini-3-flash-preview）
 * @return {string} AIの回答テキスト
 * @customfunction
 */
function gemn(promptText, systemInstruction = "", primaryModel = "gemini-3-flash-preview") {

  // -- APIキー未設定チェック --
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) return "【🔑APIキー未設定】GEMINI_API_KEY をプロジェクト設定 > スクリプトプロパティで登録してください。";

  // 試行するモデルリストを作成（重複除外）
  let candidateModels = [primaryModel];
  for (const m of GEMINI_MODELS) {
    if (m !== primaryModel) {
      candidateModels.push(m);
    }
  }

  const trialLog = []; // エラーログ記録用

  // モデル順次試行ループ
  for (const model of candidateModels) {
    const result = _callGeminiAPI(promptText, systemInstruction, model, API_KEY);

    if (result.success) {
      if (model !== primaryModel) {
        console.warn(`【Geminiフォールバック成功】${primaryModel} 失敗 -> ${model} で成功`);
      }
      return result.text;
    }

    // 失敗時ログ
    trialLog.push(`${model}: ${result.errorDetail}`);
    console.warn(`【Gemini失敗】${model}: ${result.errorDetail}`);
  }

  // 全滅
  return "【💀全API失敗】\n" + trialLog.join("\n");
}

// ============================================================
// 内部関数: 単一モデル呼び出し（リトライ付き）
// ============================================================
function _callGeminiAPI(promptText, systemInstruction, model, apiKey) {
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

  let lastError = "";

  for (let attempt = 1; attempt <= GEMN_MAX_RETRY; attempt++) {
    const startTime = Date.now();
    try {
      const response = UrlFetchApp.fetch(URL, options);
      const elapsedMs = Date.now() - startTime;
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      // -- 成功 (200) --
      if (responseCode === 200) {
        let json;
        try {
          json = JSON.parse(responseText);
        } catch (e) {
          lastError = "【⚠️JSON解析エラー】";
          if (attempt < GEMN_MAX_RETRY) Utilities.sleep(1000);
          continue;
        }

        const tokens = (json.usageMetadata && json.usageMetadata.totalTokenCount) || 0;
        if (json.candidates && json.candidates[0] && json.candidates[0].content) {
          const answer = json.candidates[0].content.parts[0].text;
          if (answer && answer.trim() !== "") {
            _logAIUsage(model, promptText, "成功", "Gemini(単体)", elapsedMs, tokens);
            return { success: true, text: answer };
          }
          lastError = "【📭空回答】モデルが空の回答を返しました。";
        } else {
          lastError = "【📭空回答】回答データの構造が不正です。";
        }

        if (attempt < GEMN_MAX_RETRY) Utilities.sleep(1000);
        continue;
      }

      // -- エラー応答 --
      const classification = _classifyHttpError_Gemini(responseCode);
      let apiMsg = "";
      try {
        const errorJson = JSON.parse(responseText);
        apiMsg = errorJson.error ? errorJson.error.message : responseText.substring(0, 150);
      } catch (e) {
        apiMsg = responseText.substring(0, 150);
      }
      lastError = classification.prefix + apiMsg;

      if (!classification.shouldRetry) {
        return { success: false, errorDetail: lastError };
      }

      if (attempt < GEMN_MAX_RETRY) Utilities.sleep(1000);

    } catch (e) {
      lastError = "【🔌接続エラー】" + e.message;
      if (attempt < GEMN_MAX_RETRY) Utilities.sleep(1000);
    }
  }

  return { success: false, errorDetail: lastError };
}

