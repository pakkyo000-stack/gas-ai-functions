
// ============================================================
// OpenRouter AI 関数 (openrouter.js)
// ============================================================
// このファイルは、スプレッドシートから「=my_AI("質問")」で
// AIに質問できる関数を提供します。
//
// 【動作の流れ】
//  1. モデルリスト(MODELS)の上から順にAIモデルを試す
//  2. 各モデルで最大3回リトライする
//  3. 全モデル失敗時は openrouter/free（自動選択）を最終手段として試す
//  4. それでもダメならエラーメッセージを返す
//
// 【使い方の例】
//  =my_AI("こんにちは")                          ← 最小構成
//  =my_AI("質問","先生として回答")                ← 役割指定
//  =my_AI("質問","先生として回答",0.5)            ← 温度(創造性)指定
//  =my_AI("質問",,,,,TRUE)                       ← モデル名表示あり
//  =my_AI("質問",,,,,"特定のモデルID")            ← モデル直接指定
//  =my_AI("質問",,,,,,"TRUE")                    ← モデル名表示あり（正式な7引数版）
// ============================================================


// ============================================================
// 1. 基本設定（APIキーやモデルの定義）
// ============================================================
// ※ API_KEY は「プロジェクト設定 > スクリプトプロパティ」で
//    OPENROUTER_API_KEY という名前で登録してください。
// ============================================================
const AI_CONFIG = {
  // OpenRouter の APIキー（スクリプトプロパティから自動取得）
  API_KEY: PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY'),

  // OpenRouter の API エンドポイント（変更不要）
  BASE_URL: 'https://openrouter.ai/api/v1/chat/completions',

  // 試行するモデルのリスト（上から順番に試す）
  // ":free" が付いているものは無料モデル
  MODELS: [
    "meta-llama/llama-3.3-70b-instruct:free",     // Meta Llama 3.3 70B（高性能）
    "meta-llama/llama-3.2-3b-instruct:free",      // Meta Llama 3.2 3B（軽量）
    "arcee-ai/trinity-large-preview:free",         // Arcee Trinity Large
    "nvidia/nemotron-3-nano-30b-a3b:free",         // NVIDIA Nemotron
    "tngtech/deepseek-r1t2-chimera:free"           // DeepSeek Chimera
  ],

  // 最終手段: OpenRouter が空いている無料モデルを自動選択するメタモデル
  FREE_MODEL: "openrouter/free",

  // （後方互換用）デフォルトモデル
  DEFAULT_MODEL: "openrouter/free",

  // AIの回答の最大文字数（トークン数）
  MAX_TOKENS: 1024,

  // 各モデルごとのリトライ回数（通信エラーなどに備える）
  MAX_RETRY: 3
};


// ============================================================
// 2. メインの AI 関数: my_AI
// ============================================================
// スプレッドシートから =my_AI("質問") で呼び出す関数
// ============================================================
/**
 * カスタムAI関数: my_AI
 * モデルリストを上から順に試行し、最終手段として openrouter/free にフォールバック。
 *
 * @param {string} promptText   今回の質問 (必須)
 * @param {string} systemInst   AIの役割・ルール (任意) 例: "英語教師として回答して"
 * @param {number} temp         温度 0.0〜2.0 (初期値 0.3)。高いほど創造的、低いほど正確
 * @param {Range}  fewShotRange 例示の範囲 [入力例, 出力例] (任意)
 * @param {Range}  historyRange 過去の対話範囲 [自分, AI] (任意)
 * @param {string} modelId      特定モデルを指定したい場合 (省略時はリスト順に自動試行)
 * @param {boolean} showModel   使用されたモデル名を回答の先頭に表示するか (初期値: false)
 * @customfunction
 */
function my_AI(promptText, systemInst, temp, fewShotRange, historyRange, modelId, showModel) {

  // ----------------------------------------------------------
  // 引数の補正処理
  // ----------------------------------------------------------
  // スプレッドシートのカスタム関数では、空のセルが "" (空文字) として渡される。
  // JavaScript のデフォルト引数は undefined のときしか効かないため、
  // ここで手動でデフォルト値を設定する。

  // よくあるミス対策: =my_AI("質問",,,,,TRUE) だと TRUE が modelId に入るため、
  // modelId に true/false が来たら showModel の指定と判断して自動シフト
  if (modelId === true || modelId === false || modelId === "TRUE" || modelId === "FALSE" || modelId === "true" || modelId === "false") {
    showModel = modelId;  // showModel に移動
    modelId = "";         // modelId は空に戻す
  }

  systemInst = systemInst || "";                                              // 空なら空文字
  temp = (temp === undefined || temp === null || temp === "") ? 0.3 : Number(temp);  // 空なら0.3
  fewShotRange = fewShotRange || null;                                        // 空ならnull
  historyRange = historyRange || null;                                        // 空ならnull
  showModel = (showModel === true || showModel === "TRUE" || showModel === "true");   // TRUE判定

  // ----------------------------------------------------------
  // 入力チェック
  // ----------------------------------------------------------
  if (!promptText) return "【通知】質問を入力してください。";
  if (!AI_CONFIG.API_KEY) return "【エラー】OPENROUTER_API_KEY が未設定です。プロジェクト設定 > スクリプトプロパティで登録してください。";

  // ----------------------------------------------------------
  // AIに送るメッセージの組み立て
  // ----------------------------------------------------------
  const messages = [];

  // ① システム指示（AIの役割設定）があれば追加
  if (systemInst) messages.push({ role: "system", content: systemInst });

  // ② Few-shot（例題）があれば追加
  //    スプレッドシートの範囲を [入力例, 出力例] の形で渡す
  if (fewShotRange && Array.isArray(fewShotRange)) {
    fewShotRange.forEach(row => {
      if (row[0] && row[1]) {
        messages.push({ role: "user", content: "Ex: " + row[0] });
        messages.push({ role: "assistant", content: "Ans: " + row[1] });
      }
    });
  }

  // ③ 履歴があれば追加
  //    過去の会話を [自分の発言, AIの回答] の形で渡す
  if (historyRange && Array.isArray(historyRange)) {
    historyRange.forEach(row => {
      if (row[0]) messages.push({ role: "user", content: row[0].toString() });
      if (row[1]) messages.push({ role: "assistant", content: row[1].toString() });
    });
  }

  // ④ 今回の質問を追加
  messages.push({ role: "user", content: promptText });

  // ----------------------------------------------------------
  // モデルの試行
  // ----------------------------------------------------------
  let lastError = "";

  // 【パターンA】モデルIDが明示指定されている場合 → そのモデルだけで試行
  if (modelId) {
    const result = _tryModel(modelId, messages, temp);
    if (result.success) {
      // 成功: 回答を返す（showModel=true なら実際のモデル名を先頭に付ける）
      return showModel ? "【" + (result.actualModel || modelId) + "】\n" + result.text : result.text;
    }
    // 失敗: エラーメッセージを返す
    return `【失敗】${modelId}: ${result.error}`;
  }

  // 【パターンB】モデルID未指定 → リストの上から順番に試す
  for (const model of AI_CONFIG.MODELS) {
    const result = _tryModel(model, messages, temp);
    if (result.success) {
      // 成功したモデルで回答を返す
      return showModel ? "【" + (result.actualModel || model) + "】\n" + result.text : result.text;
    }
    // このモデルは失敗 → 次のモデルへ
    lastError = `${model}: ${result.error}`;
    console.warn(`【失敗】${model}: ${result.error}`);
  }

  // 【パターンC】全モデル失敗 → 最終手段 openrouter/free で試す
  // openrouter/free は OpenRouter が自動的に空いている無料モデルを選んでくれる
  const freeResult = _tryModel(AI_CONFIG.FREE_MODEL, messages, temp);
  if (freeResult.success) {
    return showModel ? "【" + (freeResult.actualModel || AI_CONFIG.FREE_MODEL) + "】\n" + freeResult.text : freeResult.text;
  }

  // 本当に全部ダメだった場合
  return `【全モデル失敗】最終エラー: ${freeResult.error}`;
}


// ============================================================
// 3. 内部関数: _tryModel
// ============================================================
// 指定された1つのモデルに対し、最大MAX_RETRY回のリトライ付きで
// API呼び出しを試行する。
//
// 戻り値:
//   成功時: { success: true,  text: "AIの回答", actualModel: "実際のモデル名" }
//   失敗時: { success: false, error: "エラー理由" }
// ============================================================
function _tryModel(model, messages, temp) {

  // APIに送信するデータの組み立て
  const payload = {
    model: model,           // 使用するAIモデル
    messages: messages,     // 会話履歴+質問
    temperature: temp,      // 温度（創造性）
    max_tokens: AI_CONFIG.MAX_TOKENS  // 回答の最大長
  };

  // HTTP リクエストの設定
  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + AI_CONFIG.API_KEY },  // APIキーを添付
    payload: JSON.stringify(payload),    // データをJSON文字列に変換
    muteHttpExceptions: true             // エラー時も結果を取得（クラッシュ防止）
  };

  // リトライループ: 最大 MAX_RETRY 回試す
  for (let attempt = 1; attempt <= AI_CONFIG.MAX_RETRY; attempt++) {
    try {
      // APIにリクエスト送信
      const response = UrlFetchApp.fetch(AI_CONFIG.BASE_URL, options);
      const json = JSON.parse(response.getContentText());
      const statusCode = response.getResponseCode();

      // 成功判定: ステータス200 かつ 回答データあり
      if (statusCode === 200 && json.choices && json.choices[0]) {
        const answer = json.choices[0].message.content.trim();
        if (answer !== "") {
          // 回答あり → 成功で返す
          // json.model には OpenRouter が実際に使ったモデル名が入る
          return { success: true, text: answer, actualModel: json.model };
        }
      }

      // エラー内容を取得
      const errorMsg = json.error ? json.error.message : "コード: " + statusCode;

      // まだリトライ回数が残っていれば、少し待ってから再試行
      // 待ち時間: 1回目→2秒、2回目→4秒、3回目→6秒（段階的に増やす）
      if (attempt < AI_CONFIG.MAX_RETRY) {
        Utilities.sleep(attempt * 2000);
      }

      // 最後の試行だったらエラーを返す
      if (attempt === AI_CONFIG.MAX_RETRY) {
        return { success: false, error: errorMsg };
      }

    } catch (e) {
      // ネットワークエラーなど予期しないエラー
      if (attempt === AI_CONFIG.MAX_RETRY) {
        return { success: false, error: "接続エラー: " + e.toString() };
      }
      // まだリトライ可能なら待機して再試行
      Utilities.sleep(attempt * 2000);
    }
  }

  // ここには通常到達しない
  return { success: false, error: "不明なエラー" };
}