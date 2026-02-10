/**
 * OpenRouterから最新のモデル情報を取得し、シートを更新する
 */
function updateOpenRouterModelList() {
  const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
  
  try {
    // 1. APIからモデルデータを取得
    const fetchResponse = UrlFetchApp.fetch(OPENROUTER_MODELS_URL);
    const parsedData = JSON.parse(fetchResponse.getContentText());
    const modelArray = parsedData.data;

    // 2. 出力先のシートを準備
    const activeSS = SpreadsheetApp.getActiveSpreadsheet();
    let modelListSheet = activeSS.getSheetByName("OR_Model_List");
    
    if (!modelListSheet) {
      modelListSheet = activeSS.insertSheet("OR_Model_List");
    }
    modelListSheet.clear(); // 既存のデータをリセット

    // 3. ヘッダー行の作成
    const tableHeader = [["Model ID", "Display Name", "Free?", "Context Limit", "Description"]];
    modelListSheet.getRange(1, 1, 1, 5).setValues(tableHeader).setFontWeight("bold").setBackground("#f3f3f3");

    // 4. 各モデルの情報を整形
    const formattedRows = modelArray.map(modelEntry => {
      // 料金が0かどうかで無料判定
      const isFree = (parseFloat(modelEntry.pricing.prompt) === 0) ? "FREE" : "PAID";
      
      return [
        modelEntry.id,               // ID (gemn関数の引数に使用)
        modelEntry.name,             // 表示名
        isFree,                      // 無料フラグ
        modelEntry.context_length,   // 最大トークン数
        modelEntry.description.substring(0, 200) // 説明文(長すぎるのでカット)
      ];
    });

    // 5. シートに一括書き出し
    modelListSheet.getRange(2, 1, formattedRows.length, 5).setValues(formattedRows);
    
    // 6. フィルタをかけるなどの整形
    modelListSheet.autoResizeColumns(1, 5);
    Logger.log("モデルリストを更新しました。合計数: " + formattedRows.length);

  } catch (error) {
    Logger.log("モデルリストの取得中にエラーが発生しました: " + error.toString());
  }
}