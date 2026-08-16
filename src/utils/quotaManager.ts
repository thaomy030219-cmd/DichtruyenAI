
import { ModelQuota, ModelUsage } from '../types';
import { MODEL_CONFIGS } from '../constants';

const STORAGE_KEY = 'gemini_quota_usage_v1';
const SAFETY_BUFFER_MS = 5000; // Tăng lên 5s để đảm bảo an toàn tuyệt đối cho RPM thấp

class QuotaManager {
  private usage: Record<string, ModelUsage> = {};
  private listeners: (() => void)[] = [];
  // Store configs internally so they can be updated dynamically
  private currentConfigs: ModelQuota[] = [...MODEL_CONFIGS];
  
  // Track enabled models dynamically
  private enabledModels: Set<string> = new Set(MODEL_CONFIGS.map(m => m.id));

  // NEW: Track the last model assigned to enforce rotation
  private lastAllocatedId: string | null = null;
  
  constructor() {
    this.loadUsage();
  }

  // Allow App to update configs (e.g. from user edits)
  public updateConfigs(newConfigs: ModelQuota[]) {
    this.currentConfigs = newConfigs;
    this.notifyListeners();
  }
  
  // Update enabled models from UI state
  public setEnabledModels(models: string[]) {
      this.enabledModels = new Set(models);
  }

  public isModelEnabled(modelId: string): boolean {
      return this.enabledModels.has(modelId);
  }

  public getConfigs(): ModelQuota[] {
    return this.currentConfigs;
  }

  // NEW: Expose snapshot for UI Reactivity
  public getUsageSnapshot(): Record<string, ModelUsage> {
      return { ...this.usage };
  }

  public clearUsage() {
      this.usage = {};
      const today = new Date().toISOString().split('T')[0];
      this.currentConfigs.forEach(model => {
        this.usage[model.id] = {
          requestsToday: 0,
          lastResetDate: today,
          recentRequests: [],
          cooldownUntil: 0,
          isDepleted: false,
          consecutiveErrors: 0,
          consecutiveQuotaErrors: 0
        };
      });
      this.lastAllocatedId = null;
      this.saveUsage();
  }

  private loadUsage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.usage = JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load quota usage", e);
    }
    
    // Initialize missing models and check for daily reset
    this.applyDailyResetIfNeeded();
  }

  // UPDATED v11.5.9: FIX lỗi "HẾT quota" bị dính mãi dù đã sang ngày mới. Trước đây logic reset
  // theo ngày (so sánh lastResetDate với ngày hôm nay) CHỈ chạy đúng 1 lần trong loadUsage() —
  // tức là chỉ chạy khi app KHỞI ĐỘNG (tải trang/F5). Nếu người dùng cứ để tab mở liên tục nhiều
  // ngày không tải lại trang (rất phổ biến, nhất là khi để chạy dịch qua đêm), logic reset không
  // bao giờ được gọi lại -> cờ isDepleted bị dính mãi mãi dù ngày mới đã bắt đầu từ lâu và
  // requestsToday thực ra vẫn đang là 0. Tách logic ra hàm public riêng để có thể gọi lại định kỳ
  // (xem App.tsx: gọi mỗi khi tab quay lại foreground + set interval định kỳ), không chỉ lúc khởi
  // động app.
  public applyDailyResetIfNeeded() {
    const today = new Date().toISOString().split('T')[0];
    let changed = false;
    
    // Use currentConfigs instead of static import
    this.currentConfigs.forEach(model => {
      if (!this.usage[model.id] || this.usage[model.id].lastResetDate !== today) {
        // Reset daily counters
        this.usage[model.id] = {
          requestsToday: 0,
          lastResetDate: today,
          recentRequests: [],
          cooldownUntil: 0,
          isDepleted: false,
          consecutiveErrors: 0,
          consecutiveQuotaErrors: 0
        };
        changed = true;
      } else {
          // Ensure fields exist for loaded data
          if (this.usage[model.id].consecutiveErrors === undefined) {
              this.usage[model.id].consecutiveErrors = 0;
              changed = true;
          }
          if (this.usage[model.id].consecutiveQuotaErrors === undefined) {
              this.usage[model.id].consecutiveQuotaErrors = 0;
              changed = true;
          }
      }
    });
    if (changed) this.saveUsage();
  }

  private saveUsage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.usage));
      this.notifyListeners();
    } catch (e) {
      console.error("Failed to save quota usage", e);
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(l => l());
  }

  public getModelUsage(modelId: string): ModelUsage {
    return this.usage[modelId];
  }

  /**
   * Check if a model is completely dead for the day (Hard Quota or Too Many Errors).
   * Does NOT check for RPM (Soft Limit).
   */
  public isModelDepleted(modelId: string): boolean {
      const usage = this.usage[modelId];
      const modelConfig = this.currentConfigs.find(m => m.id === modelId);
      if (!usage || !modelConfig) return true;
      
      // 1. Marked as depleted
      if (usage.isDepleted) return true;
      
      // 2. Daily limit reached
      if (usage.requestsToday >= modelConfig.rpdLimit) return true;
      
      return false;
  }

  /**
   * PRECISE SLIDING WINDOW CALCULATION
   * Tính toán chính xác thời gian phải chờ dựa trên lịch sử request.
   */
  public getWaitTimeForModel(modelId: string): number {
      const usage = this.usage[modelId];
      const modelConfig = this.currentConfigs.find(m => m.id === modelId);
      
      if (!usage || !modelConfig) return Infinity;
      if (this.isModelDepleted(modelId)) return Infinity;

      const now = Date.now();
      let waitTime = 0;

      // 1. Check Explicit Cooldown (Hard 429 from Google or Error Penalty)
      if (usage.cooldownUntil > now) {
          waitTime = Math.max(waitTime, usage.cooldownUntil - now);
      }

      // 2. Check RPM Sliding Window (Strict Local Limit)
      // Lọc các request trong vòng 60s + buffer
      const windowSize = 60000; 
      const recent = usage.recentRequests.filter(t => now - t < windowSize);
      
      // LOGIC MỚI: Nếu số lượng request GẦN ĐÂY (kể cả vừa mới gọi chưa xong) >= Limit
      if (recent.length >= modelConfig.rpmLimit) {
          // Sắp xếp tăng dần: [T1, T2, T3...] (T1 là cũ nhất)
          const sorted = recent.sort((a, b) => a - b);
          
          // Index của thằng cần "expire" = (Length - Limit)
          const blockingRequestTime = sorted[recent.length - modelConfig.rpmLimit];
          
          if (blockingRequestTime) {
              const timeUntilExpiry = (blockingRequestTime + windowSize) - now;
              if (timeUntilExpiry > 0) {
                  // Thêm SAFETY_BUFFER_MS để chắc chắn Google đã reset counter bên server
                  waitTime = Math.max(waitTime, timeUntilExpiry + SAFETY_BUFFER_MS);
              }
          }
      }
      
      // 3. Cơ chế phục hồi/tránh quá tải (Spaced Out Requests)
      // Đợi chờ giữa các request để rải đều trong 60s, tránh burst 429
      if (recent.length > 0) {
          const lastRequestTime = Math.max(...recent);
          const minSpacing = windowSize / modelConfig.rpmLimit; // VD: rpm=2 -> 30000ms
          const timeSinceLast = now - lastRequestTime;
          if (timeSinceLast < minSpacing) {
              waitTime = Math.max(waitTime, minSpacing - timeSinceLast);
          }
      }

      return waitTime;
  }

  /**
   * Check if a model is currently available for use (WaitTime == 0).
   */
  public isModelAvailable(modelId: string): boolean {
    // 0. Check Enabled State (UI Toggle)
    if (!this.isModelEnabled(modelId)) return false;

    const usage = this.usage[modelId];
    if (!usage) return false;

    // 1. Check Hard Stop (Depleted)
    if (this.isModelDepleted(modelId)) return false;

    // 2. Check Calculated Wait Time
    return this.getWaitTimeForModel(modelId) === 0;
  }

  /**
   * SMART LOAD BALANCER v2.1 (Interleaved Round Robin)
   * Prioritize rotation: If we just used Model A, try hard to use Model B next.
   */
  public getBestModelForTask(candidates: string[], excludedModels: string[] = [], preferredModelId?: string, priorityOverrides?: Record<string, number>): string | null {
      const now = Date.now();
      const windowSize = 60000;

      // 0. Filter Candidates
      const eligibleCandidates = candidates.filter(id => 
          this.isModelEnabled(id) && 
          !this.isModelDepleted(id) &&
          !excludedModels.includes(id)
      );

      if (eligibleCandidates.length === 0) return null;

      // --- STRICT PREFERRED MODEL (Wait if on RPM cooldown) ---
      // If the caller explicitly prefers a model, we ONLY use that model unless it is depleted.
      if (preferredModelId && eligibleCandidates.includes(preferredModelId)) {
          if (this.isModelAvailable(preferredModelId)) {
              return preferredModelId;
          }
          // The preferred model is eligible but NOT ready (RPM cooldown).
          // We return null to force the caller to WAIT, instead of falling back.
          return null;
      }

      // 1. Find Ready Models (Wait Time == 0)
      const readyModels = eligibleCandidates.filter(id => this.isModelAvailable(id));

      if (readyModels.length > 0) {
          // --- THUẬT TOÁN LEAST LOADED + ROTATION PENALTY ---
          const modelScores = readyModels.map(id => {
              const usage = this.usage[id];
              const config = this.currentConfigs.find(c => c.id === id);
              if (!usage || !config) return { id, score: 999 };

              const recentCount = usage.recentRequests.filter(t => now - t < windowSize).length;
              
              // Base Score: Priority (dominant) + RPM Load (80%) + RPD Load (20%)
              const rpmLoad = recentCount / Math.max(1, config.rpmLimit);
              const rpdLoad = usage.requestsToday / Math.max(1, config.rpdLimit);
              
              // Nếu có priorityOverrides riêng cho tác vụ này (vd hậu kiểm Tier 2), dùng nó thay
              // vì priority mặc định trong MODEL_CONFIGS — để KHÔNG ảnh hưởng thứ tự ưu tiên
              // dùng cho dịch/Auto-Fix (vốn cũng đọc chung config.priority này).
              const effectivePriority = (priorityOverrides && priorityOverrides[id] !== undefined) ? priorityOverrides[id] : (config.priority || 5);
              const priorityBase = effectivePriority * 100; // Heavily weight by priority
              let score = priorityBase + (rpmLoad * 0.8) + (rpdLoad * 0.2);

              // *** ROTATION PENALTY ***
              if (id === this.lastAllocatedId && readyModels.length > 1) {
                  score += 0.5; // Significant penalty to push it to bottom
              }
              
              return { id, score };
          });

          // Sort: Thấp nhất lên đầu
          modelScores.sort((a, b) => a.score - b.score);
          
          return modelScores[0].id;
      }

      // 2. If no one is ready, return null so the caller (smartExecution) can wait
      return null;
  }

  // --- NEW: Helper for UI to "Reserve" a model so the next concurrent loop picks a different one ---
  public notifyAllocation(modelId: string) {
      this.lastAllocatedId = modelId;
  }

  public hasAvailableModels(modelIds: string[]): boolean {
      return modelIds.some(id => !this.isModelDepleted(id) && this.isModelEnabled(id));
  }

  // Checks if models are available AND not on a long cooldown (>15s)
  public hasReadyModels(modelIds: string[]): boolean {
      return modelIds.some(id => {
          if (!this.isModelEnabled(id) || this.isModelDepleted(id)) return false;
          const usage = this.usage[id];
          if (usage && usage.cooldownUntil > Date.now() + 15000) return false;
          return true;
      });
  }

  // --- CHANGED: Call this BEFORE calling API to reserve slot ---
  public recordRequest(modelId: string) {
    const usage = this.usage[modelId];
    if (usage) {
      this.lastAllocatedId = modelId; // Update rotation tracker
      // DO NOT increment requestsToday here to avoid inflating the count on retries
      usage.recentRequests.push(Date.now()); 
      
      // Cleanup old entries
      const now = Date.now();
      usage.recentRequests = usage.recentRequests.filter(t => now - t < 70000);
      
      this.saveUsage();
    }
  }

  // --- NEW: Call this AFTER successful API response ---
  public recordSuccess(modelId: string) {
      const usage = this.usage[modelId];
      if (usage) {
          usage.requestsToday++; // Increment only on success
          usage.consecutiveErrors = 0; // Reset normal errors
          usage.consecutiveQuotaErrors = 0; // Reset quota errors
          this.saveUsage();
      }
  }

  public recordError(modelId: string) {
      const usage = this.usage[modelId];
      if (usage) {
          usage.consecutiveErrors = (usage.consecutiveErrors || 0) + 1;
          
          // SOFT PENALTY: Force this model to cool down for 30s to let Load Balancer pick another one
          usage.cooldownUntil = Date.now() + 30000;
          this.saveUsage();
      }
  }

  public recordQuotaError(modelId: string) {
      const usage = this.usage[modelId];
      if (usage) {
          usage.consecutiveQuotaErrors = (usage.consecutiveQuotaErrors || 0) + 1;
          this.saveUsage();
      }
  }

  public recordRateLimit(modelId: string, duration: number = 60000) {
    const usage = this.usage[modelId];
    if (usage) {
      // Explicit cooldown from Server response (Hard 429)
      usage.cooldownUntil = Date.now() + duration; 
      this.saveUsage();
    }
  }

  public markAsDepleted(modelId: string) {
      const usage = this.usage[modelId];
      if (usage) {
          usage.isDepleted = true;
          // Cooldown 10 mins instead of 1 hour for error-based depletion (to allow retry)
          usage.cooldownUntil = Date.now() + 600000;
          this.saveUsage();
      }
  }

  public reset() {
    this.usage = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.loadUsage(); 
    this.notifyListeners();
  }

  public resetDailyQuotas() {
    const today = new Date().toISOString().split('T')[0];
    for (const key in this.usage) {
        this.usage[key] = {
            ...this.usage[key],
            requestsToday: 0,
            isDepleted: false,
            lastResetDate: today,
            consecutiveErrors: 0,
            cooldownUntil: 0,
            recentRequests: [] // Reset recent history too
        };
    }
    this.lastAllocatedId = null; // Reset rotation tracker
    this.saveUsage();
  }
}

export const quotaManager = new QuotaManager();
