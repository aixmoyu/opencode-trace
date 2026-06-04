export {
  startRecording,
  stopRecording,
  isRecording,
  getRecordingStatus,
  listRecordings,
  initStateManager,
  syncState,
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
