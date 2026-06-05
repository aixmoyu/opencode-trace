export {
  startRecording,
  stopRecording,
  isRecording,
  getRecordingStatus,
  listRecordings,
  initStateManager,
  setGlobalTraceEnabled,
  getGlobalTraceEnabled,
  setSessionEnabled,
  getSessionEnabled,
  shouldRecord,
  setStoragePreference,
  getStoragePreference,
  setSessionStoragePreference,
  getSessionStoragePreference,
} from "./control.js";
export type { RecordingStatus } from "./control.js";
