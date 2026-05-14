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
} from "./control.js";
export type { RecordingStatus } from "./control.js";
