/** Desk copy. Chinese is the source; English must cover the same keys. */
export const zhDeskInspector = {
  "inspector.label": "文件与更改",
  "inspector.close": "关闭文件与更改",
  "inspector.expand": "整页打开",
  "inspector.repo": "仓库 {name}：分支与路径",
  "inspector.backToList": "{name}，返回列表",
  "inspector.switchFile": "{name}，切换文件",
  "inspector.resize": "调整文件与更改的宽度",
  "column.resizeHint": "左右方向键调整宽度，Home 和 End 到最窄和最宽。按回车或连按两下这条线，恢复默认宽度。",
  "column.widthPx": "{width} 像素",
} as const;

export const enDeskInspector: { [K in keyof typeof zhDeskInspector]: string } = {
  "inspector.label": "Files and changes",
  "inspector.close": "Close files and changes",
  "inspector.expand": "Open as a full page",
  "inspector.repo": "Repository {name}: branches and path",
  "inspector.backToList": "{name}, back to the list",
  "inspector.switchFile": "{name}, switch file",
  "inspector.resize": "Resize files and changes",
  "column.resizeHint": "Left and Right change the width; Home and End go to the narrowest and the widest. Press Enter, or press the line twice, for the default width.",
  "column.widthPx": "{width} pixels",
};
