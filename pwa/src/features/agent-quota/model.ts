/**
 * The quota projections, re-exported from the files that own them: providers
 * and their order, one meter, the page's cards and groups, what to tell the
 * reader about an account without numbers, and the settings module.
 */
export { orderAccounts, providerNames, shortProviderNames, type QuotaProvider } from "./providers";
export {
  amountText, meterExpired, meterLabel, meterLow, meterModel, meterSummarySub, quotaResetAt, quotaResetIn, quotaRowModel, quotaTone,
  quotaWindowName, sampleStale, summaryMeter, type QuotaMeterModel, type QuotaRowModel, type QuotaTone,
} from "./meter-model";
export { quotaGuidance, throttledCopy, type QuotaGuidance } from "./guidance";
export {
  quotaCardModel, quotaPanelModel, updatedCopy, type QuotaCardModel, type QuotaNoticeModel, type QuotaPanelModel, type QuotaSnapshotLike,
} from "./card-model";
export { MODULE_ROWS, quotaModuleModel, type QuotaModuleModel, type QuotaModuleRow } from "./module-model";
