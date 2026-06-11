# 小隊衝衝衝

一款以 Canvas 製作的明亮休閒編隊跑酷遊戲。左右切換軌道、招募夥伴、收集金幣、突破敵軍，最後擊敗城堡巨人。

## 操作

- 桌面：`A` / `D` 或方向鍵
- 手機：在遊戲畫面左右拖曳
- 暫停：`P`、`Esc` 或右上角暫停按鈕

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
