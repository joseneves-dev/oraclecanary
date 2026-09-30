/** Public Telegram channel with the alerts for every listed reserve. */
export const TELEGRAM_CHANNEL_URL = 'https://t.me/OracleCanaryAlerts'

/**
 * The bot people message for alerts about their own wallet. The "start" parameter subscribes the
 * wallet straight away (see indexer/src/walletBot.ts).
 */
export const TELEGRAM_BOT = 'OracleCanaryBot'
export const walletAlertsUrl = (wallet: string) => `https://t.me/${TELEGRAM_BOT}?start=${wallet}`
