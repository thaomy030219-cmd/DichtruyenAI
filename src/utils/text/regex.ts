// Unicode script ranges intentionally include combining marks used by these scripts.
// eslint-disable-next-line no-misleading-character-class
export const FOREIGN_CHARS_REGEX = /[\u0370-\u03ff\u0400-\u052f\u0600-\u06ff\u0750-\u077f\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
export const BATCH_MISSING_TAG_WARNING = "::: [HỆ THỐNG CẢNH BÁO: AI QUÊN TAG PHÂN TÁCH] :::";
export const UPPER_VI = 'A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ';
export const LOWER_VI = 'a-zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ';

export interface LineContext {
  index: number;
  originalLine: string;
}
