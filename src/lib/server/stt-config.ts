export const LOCAL_STT_MODEL = 'sensevoice-small-int8';

/** Public configuration only. URLs and credentials never enter the player view. */
export function sttConfiguration() {
  const provider = process.env.STT_PROVIDER?.trim() || 'local';
  const model = provider === 'zhipu'
    ? process.env.ZHIPU_STT_MODEL?.trim() || 'glm-asr-2512'
    : process.env.STT_MODEL?.trim() || (provider === 'local' ? LOCAL_STT_MODEL : '');
  return { provider, model };
}
