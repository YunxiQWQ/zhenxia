import type { Settings } from '../../types';

export type UpdateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void;
export type UpdateSettings = (
  updates: Partial<Settings>,
  replaceCaptureFields?: (keyof import('../../utils/capturePreferences').CapturePreferences)[]
) => void;
