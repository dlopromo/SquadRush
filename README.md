# Squad Rush

一款以 Canvas 製作的休閒編隊射擊跑酷遊戲。左右自由移動，選擇算術門壯大隊伍，自動射擊敵兵與障礙，並在每關終點擊敗 Boss。

## 操作

- 桌面：按住 `A` / `D` 或方向鍵連續移動
- 手機：在整條道路上左右拖曳
- 暫停：`P`、`Esc` 或右上角暫停按鈕

## 遊戲內容

- Stage 1–7：固定編排的算術門、敵軍、輪胎、武器和 Boss
- Stage 8 起：可重現的程序生成關卡，可持續遊玩
- 永久成長：金幣會自動提升起始人數、傷害與射速
- 失敗補償：保留金幣與升級，重試原關且 Boss 會稍微變弱

## 本地開發

```bash
npm install
npm run dev
```

## 測試與建置

```bash
npm run check
```

## GitHub Pages

專案已包含 `.github/workflows/deploy.yml`。將倉庫推送至 `main` 分支，並在 GitHub 的 **Settings → Pages → Source** 選擇 **GitHub Actions**，即可自動部署。

所有遊戲圖像皆由 Canvas 即時繪製，音效與節奏則由 Web Audio API 即時合成，不需要外部素材或後端服務。
