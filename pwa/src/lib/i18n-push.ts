export const zhPush = {
  "push.inviteTitle": "需要你时，通知你",
  "push.inviteBody": "任务完成或需要你处理时，接收这台电脑的通知。你可以随时在设置中开启。",
  "push.homeScreen": "在浏览器分享菜单中选择“添加到主屏幕”，再从主屏幕打开 Pairfob，即可开启通知。",
  "push.later": "稍后",
  "push.inviteFailed": "通知尚未开启。请查看提示，或稍后到设置中重试。",
  "push.otherComputer": "这个浏览器已为另一台电脑订阅通知。请使用另一个浏览器配置文件为这台电脑开启通知。",
} as const;

export const enPush: { [K in keyof typeof zhPush]: string } = {
  "push.inviteTitle": "Know when you’re needed",
  "push.inviteBody": "Get notifications from this computer when a task finishes or needs your attention. You can also enable them later in Settings.",
  "push.homeScreen": "Choose Add to Home Screen from your browser’s share menu, then open Pairfob from the Home Screen to enable notifications.",
  "push.later": "Later",
  "push.inviteFailed": "Notifications are not on yet. Check the message, or try again in Settings later.",
  "push.otherComputer": "This browser already receives notifications from another computer. Use another browser profile to enable notifications from this one.",
};
