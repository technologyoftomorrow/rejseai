// session-manager.js
// Gem denne fil i services/ eller utils/ mappen

/**
 * In-memory session manager til at håndtere chat-historik
 * I en produktionsmiljø ville du bruge en database i stedet
 */
class SessionManager {
  constructor() {
    this.sessions = new Map(); // Map til at gemme session data
    this.maxHistoryLength = 20; // Maksimalt antal beskeder i historikken
    this.sessionTimeout = 1000 * 60 * 60 * 24; // 24 timers timeout
    
    // Start periodisk rensning af gamle sessioner
    this.startCleanupInterval();
  }

  /**
   * Hent chat-historik for en given session
   * @param {string} sessionId - Unik session identifikator
   * @returns {Array} Array af besked-objekter
   */
  getSessionHistory(sessionId) {
    if (!sessionId) return [];
    
    // Hent eksisterende session eller opret en ny
    const session = this.sessions.get(sessionId) || {
      messages: [],
      lastAccessed: Date.now()
    };
    
    // Opdater 'lastAccessed' tidspunkt
    session.lastAccessed = Date.now();
    this.sessions.set(sessionId, session);
    
    return [...session.messages]; // Returner en kopi for at undgå direkte ændringer
  }

  /**
   * Tilføj nye beskeder til en sessions historik
   * @param {string} sessionId - Unik session identifikator
   * @param {Array} newMessages - Array af nye besked-objekter
   */
  addToSessionHistory(sessionId, newMessages) {
    if (!sessionId || !newMessages || !newMessages.length) return;
    
    // Hent eksisterende session eller opret en ny
    const session = this.sessions.get(sessionId) || {
      messages: [],
      lastAccessed: Date.now()
    };
    
    // Tilføj nye beskeder
    session.messages = [
      ...session.messages,
      ...newMessages
    ];
    
    // Begræns historikken til maksimal længde
    if (session.messages.length > this.maxHistoryLength) {
      // Behold system-besked (hvis den findes) og de nyeste beskeder
      const systemMessage = session.messages.find(msg => msg.role === 'system');
      let recentMessages = session.messages.slice(-this.maxHistoryLength);
      
      if (systemMessage && !recentMessages.includes(systemMessage)) {
        recentMessages = [systemMessage, ...recentMessages.slice(1)];
      }
      
      session.messages = recentMessages;
    }
    
    // Opdater 'lastAccessed' tidspunkt
    session.lastAccessed = Date.now();
    this.sessions.set(sessionId, session);
    
    console.log(`📝 Opdateret session ${sessionId} med ${newMessages.length} nye beskeder. Total: ${session.messages.length}`);
  }

  /**
   * Ryd gamle sessioner periodisk
   */
  startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      let removedCount = 0;
      
      for (const [sessionId, session] of this.sessions.entries()) {
        // Fjern sessioner der ikke er blevet brugt i 'sessionTimeout' millisekunder
        if (now - session.lastAccessed > this.sessionTimeout) {
          this.sessions.delete(sessionId);
          removedCount++;
        }
      }
      
      if (removedCount > 0) {
        console.log(`🧹 Fjernet ${removedCount} inaktive sessioner. Aktive sessioner: ${this.sessions.size}`);
      }
    }, 1000 * 60 * 30); // Kør hver 30. minut
  }

  /**
   * Statistik om sessioner (nyttigt til debugging)
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      oldestSession: this.getOldestSessionAge(),
      newestSession: this.getNewestSessionAge(),
      averageMessagesPerSession: this.getAverageMessagesPerSession()
    };
  }

  getOldestSessionAge() {
    if (this.sessions.size === 0) return null;
    
    const now = Date.now();
    let oldest = now;
    
    for (const session of this.sessions.values()) {
      if (session.lastAccessed < oldest) {
        oldest = session.lastAccessed;
      }
    }
    
    return Math.round((now - oldest) / (1000 * 60)); // Alder i minutter
  }

  getNewestSessionAge() {
    if (this.sessions.size === 0) return null;
    
    const now = Date.now();
    let newest = 0;
    
    for (const session of this.sessions.values()) {
      if (session.lastAccessed > newest) {
        newest = session.lastAccessed;
      }
    }
    
    return Math.round((now - newest) / (1000 * 60)); // Alder i minutter
  }

  getAverageMessagesPerSession() {
    if (this.sessions.size === 0) return 0;
    
    let totalMessages = 0;
    
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
    }
    
    return Math.round(totalMessages / this.sessions.size);
  }
}

// Eksporter en singleton-instans
export default new SessionManager();