
const DB_NAME = 'TranslationAppDB';
const STORE_NAME = 'app_session';
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

// Helper to check if CompressionStream is supported
const isCompressionSupported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

const compressData = async (data: any): Promise<any> => {
    if (!isCompressionSupported) return data;
    try {
        const jsonString = JSON.stringify(data);
        const stream = new Blob([jsonString]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const response = new Response(compressedStream);
        const buffer = await response.arrayBuffer();
        return { __compressed: true, data: new Uint8Array(buffer) };
    } catch (e) {
        console.warn("Compression failed, falling back to uncompressed data", e);
        return data;
    }
};

const decompressData = async (storedData: any): Promise<any> => {
    if (!storedData || !storedData.__compressed) return storedData;
    if (!isCompressionSupported) {
        throw new Error("Data is compressed but DecompressionStream is not supported in this browser.");
    }
    try {
        const stream = new Blob([storedData.data]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const response = new Response(decompressedStream);
        const jsonString = await response.text();
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Decompression failed", e);
        throw e;
    }
};

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    // Reuse existing connection if valid
    if (dbInstance) {
        resolve(dbInstance);
        return;
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error("IndexedDB Open Error:", (event.target as IDBOpenDBRequest).error);
        reject((event.target as IDBOpenDBRequest).error);
      };

      request.onsuccess = () => {
        dbInstance = request.result;
        
        // Handle connection closing (e.g. adjacent tabs)
        dbInstance.onversionchange = () => {
            dbInstance?.close();
            dbInstance = null;
        };
        dbInstance.onclose = () => {
            dbInstance = null;
        };

        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      
      // Safety timeout for browsers that lock IDB (like Cốc Cốc sometimes does)
      setTimeout(() => {
          if (request.readyState === 'pending') {
              // Don't reject, just warn. The callback might still happen.
              console.warn("IndexedDB open request is taking longer than expected...");
          }
      }, 3000);

    } catch (e) {
      reject(e);
    }
  });
};

export const saveToStorage = async (key: string, data: any, retryCount = 0): Promise<void> => {
  try {
    const db = await initDB();
    const dataToStore = await compressData(data);
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(dataToStore, key);

        // Use transaction.oncomplete for better data integrity guarantee
        transaction.oncomplete = () => resolve();
        
        transaction.onerror = (event) => {
             console.error("Transaction Error:", (event.target as IDBTransaction).error);
             reject((event.target as IDBTransaction).error);
        };
        
        request.onerror = (event) => {
             // Fallback if transaction error doesn't catch it
             reject((event.target as IDBRequest).error);
        };

      } catch (e) {
        // If transaction fails (e.g. database closed unexpectedly), reset instance and retry once
        console.warn("Transaction creation failed, resetting DB connection...", e);
        dbInstance = null;
        if (retryCount < 1) {
            console.log("Retrying saveToStorage...");
            resolve(saveToStorage(key, data, retryCount + 1));
        } else {
            reject(e);
        }
      }
    });
  } catch (error) {
    console.warn('Lỗi lưu trữ (Storage Error):', error);
    // If error is due to closed connection, try to reset dbInstance for next time
    if (error instanceof Error && (error.name === 'InvalidStateError' || error.message.includes('closed'))) {
        dbInstance = null;
        if (retryCount < 1) {
            console.log("Retrying saveToStorage after init error...");
            return saveToStorage(key, data, retryCount + 1);
        }
    }
    throw error; // Re-throw to let hook handle it
  }
};

export const loadFromStorage = async (key: string): Promise<any> => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            try {
                const decompressed = await decompressData(request.result);
                resolve(decompressed);
            } catch (e) {
                reject(e);
            }
        };
      } catch (e) {
        dbInstance = null;
        reject(e);
      }
    });
  } catch (error) {
    console.error('Lỗi đọc lưu trữ (Load Error):', error);
    throw error; // Throw instead of returning null to distinguish from "not found"
  }
};

/**
 * Reset App V4: Soft Reset Support
 * Đóng kết nối và xóa Database.
 * Resolve promise ngay cả khi blocked để UI không bị treo.
 */
export const clearDatabase = async (): Promise<void> => {
  // 1. Cưỡng chế đóng kết nối hiện tại để nhả khóa
  if (dbInstance) {
    try {
        dbInstance.close();
    } catch { /* ignore */ }
    dbInstance = null;
  }
  
  return new Promise((resolve) => {
    let isResolved = false;
    const safeResolve = () => {
        if (!isResolved) {
            isResolved = true;
            resolve();
        }
    };

    // Timeout after 1.5 seconds to prevent hanging
    setTimeout(() => {
        if (!isResolved) {
            console.warn("DB Delete Timed Out - Forcing Continue");
            safeResolve();
        }
    }, 1500);

    try {
      const req = window.indexedDB.deleteDatabase(DB_NAME);
      
      req.onsuccess = () => safeResolve();
      req.onerror = () => {
          console.warn("DB Delete Error (Ignored)");
          safeResolve();
      };
      req.onblocked = () => {
          console.warn("DB Delete Blocked (Ignored)");
          safeResolve();
      };
    } catch {
      safeResolve();
    }
  });
};
