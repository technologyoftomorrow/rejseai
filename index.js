import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import aiService from './services/aiService.js';
import path from 'path';
import { fileURLToPath } from 'url';
import sessionManager from './services/session-manager.js';
import { EventEmitter } from 'events';

const logEmitter = new EventEmitter();
const connectedClients = new Set();

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  // Send til original console
  originalConsoleLog(...args);
  
  // Broadcast til connected clients
  broadcastLog(message, 'info');
};

console.error = (...args) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  originalConsoleError(...args);
  broadcastLog(message, 'error');
};

console.warn = (...args) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  originalConsoleWarn(...args);
  broadcastLog(message, 'warn');
};

// Broadcast log til alle connected clients
function broadcastLog(message, level = 'info') {
  const logData = {
    message,
    level,
    timestamp: new Date().toISOString()
  };
  
  logEmitter.emit('log', logData);
}

// For at få __dirname i ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Konfigurer statisk fil-serving fra public mappen hvis den findes
import fs from 'fs';
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  // Kun server statiske filer hvis mappen findes
  app.use(express.static(publicDir));
  console.log('📂 Serverer statiske filer fra: ' + publicDir);
}

// Opdater Content-Type header for API-kald, men ikke for statiske filer
app.use((req, res, next) => {
  // Kun sæt Content-Type for API-endpoints
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

// Basic routes - Root path afhænger af om vi har en frontend
app.get('/', (_req, res) => {
  // Tjek om vi har en index.html fil i public mappen
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    res.sendFile(path.join(publicDir, 'index.html'));
  } else {
    // Hvis ikke, vis API info
    res.json({
      message: 'AI Message Handler API',
      status: 'running',
      timestamp: new Date().toISOString(),
      note: 'For at aktivere frontend UI, opret en public mappe med en index.html fil'
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessionId) {
    return res.status(400).json({
      error: 'Session ID er påkrævet'
    });
  }
  
  const sessionHistory = sessionManager.getSessionHistory(sessionId);
  
  res.json({
    success: true,
    sessionId,
    messageCount: sessionHistory.length,
    hasHistory: sessionHistory.length > 0,
    timestamp: new Date().toISOString()
  });
});

// Log streaming endpoint - tilføj denne route til din app
app.get('/api/logs/stream', (req, res) => {
  console.log('📡 New log stream client connected');
  
  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  // Send initial connection message
  const welcomeMessage = {
    message: 'Log stream connected successfully',
    level: 'success',
    timestamp: new Date().toISOString()
  };
  
  res.write(`data: ${JSON.stringify(welcomeMessage)}\n\n`);

  // Add client to connected set
  connectedClients.add(res);

  // Listen for log events
  const logHandler = (logData) => {
    try {
      res.write(`data: ${JSON.stringify(logData)}\n\n`);
    } catch (error) {
      // Client disconnected, remove from set
      connectedClients.delete(res);
      logEmitter.removeListener('log', logHandler);
    }
  };

  logEmitter.on('log', logHandler);

  // Handle client disconnect
  req.on('close', () => {
    console.log('📡 Log stream client disconnected');
    connectedClients.delete(res);
    logEmitter.removeListener('log', logHandler);
  });

  req.on('error', (error) => {
    console.error('📡 Log stream error:', error);
    connectedClients.delete(res);
    logEmitter.removeListener('log', logHandler);
  });
});

// Log statistics endpoint (optional)
app.get('/api/logs/stats', (req, res) => {
  res.json({
    connectedClients: connectedClients.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Opdateret chat endpoint med session-støtte
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, chatId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Messages array is required',
        example: {
          messages: [{ role: 'user', content: 'Hello!' }],
          chatId: 'optional-chat-id'
        }
      });
    }

    // Generate chatId if not provided
    const sessionId = chatId || `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Hent eksisterende session historik
    const sessionHistory = sessionManager.getSessionHistory(sessionId);
    
    // Kombiner sessionshistorik med de nye beskeder
    let combinedMessages = [...sessionHistory];
    
    // Hvis de indsendte beskeder kun indeholder én brugerbesked, tilføj den til historikken
    if (messages.length === 1 && messages[0].role === 'user') {
      combinedMessages.push(messages[0]);
    } 
    // Ellers brug de indsendte beskeder direkte (typisk fra frontend der allerede har hele historikken)
    else {
      combinedMessages = messages;
    }

    // Convert messages to LangChain format
    const langchainMessages = aiService.convertToLangChainMessages(combinedMessages);

    console.log(`🔄 Processing chat request for session: ${sessionId}`);
    console.log(`📝 Messages count: ${combinedMessages.length}`);

    // Check if streaming is requested
    const shouldStream = req.headers.accept === 'text/event-stream' || req.query.stream === 'true';

    if (shouldStream) {
      // Set headers for Server-Sent Events
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const stream = await aiService.submitQuestion(langchainMessages, sessionId);

      let fullResponse = '';
      let hasContent = false;

      for await (const chunk of stream) {
        if (chunk.event === 'on_chat_model_stream' && chunk.data?.chunk?.content) {
          // Handle both string content and content arrays  
          const content = chunk.data.chunk.content;
          let textContent = '';
          
          if (typeof content === 'string') {
            textContent = content;
          } else if (Array.isArray(content)) {
            content.forEach(item => {
              if (typeof item === 'string') {
                textContent += item;
              } else if (item?.text) {
                textContent += item.text;
              }
            });
          }
          
          if (textContent) {
            fullResponse += textContent;
            hasContent = true;
            
            // Send chunk to client
            res.write(`data: ${JSON.stringify({ 
              type: 'chunk', 
              content: textContent,
              chatId: sessionId 
            })}\n\n`);
          }
        }
      }

      // If we didn't get any content in chunks, send a fallback response
      if (!hasContent) {
        console.log("⚠️ No content chunks received, sending fallback response");
        const fallbackResponse = "Jeg kunne ikke generere et svar. Prøv venligst igen.";
        
        // Send a chunk with the fallback content
        res.write(`data: ${JSON.stringify({ 
          type: 'chunk', 
          content: fallbackResponse,
          chatId: sessionId 
        })}\n\n`);
        
        fullResponse = fallbackResponse;
      }

      // Gem AI-svaret i session historikken
      sessionManager.addToSessionHistory(sessionId, [
        // Den seneste brugerbesked (hvis den findes)
        ...combinedMessages.filter(msg => msg.role === 'user').slice(-1),
        // AI-svaret
        { role: 'assistant', content: fullResponse }
      ]);

      // Send final message
      res.write(`data: ${JSON.stringify({ 
        type: 'done', 
        fullResponse,
        chatId: sessionId 
      })}\n\n`);
      
      res.end();
    } else {
      // Non-streaming response
      const stream = await aiService.submitQuestion(langchainMessages, sessionId);
      
      let fullResponse = '';
      let toolCalls = [];

      for await (const chunk of stream) {
        if (chunk.event === 'on_chat_model_stream' && chunk.data?.chunk?.content) {
          // Handle both string content and content arrays
          const content = chunk.data.chunk.content;
          if (typeof content === 'string') {
            fullResponse += content;
          } else if (Array.isArray(content)) {
            content.forEach(item => {
              if (typeof item === 'string') {
                fullResponse += item;
              } else if (item?.text) {
                fullResponse += item.text;
              }
            });
          }
        }
        if (chunk.event === 'on_chat_model_stream' && chunk.data?.chunk?.tool_calls) {
          toolCalls.push(...chunk.data.chunk.tool_calls);
        }
      }

      // If we didn't get any response, send a fallback
      if (!fullResponse) {
        console.log("⚠️ No response content received in non-streaming mode, sending fallback");
        fullResponse = "Jeg kunne ikke generere et svar. Prøv venligst igen.";
      }

      // Gem AI-svaret i session historikken
      sessionManager.addToSessionHistory(sessionId, [
        // Den seneste brugerbesked (hvis den findes)
        ...combinedMessages.filter(msg => msg.role === 'user').slice(-1),
        // AI-svaret
        { role: 'assistant', content: fullResponse }
      ]);

      res.json({
        success: true,
        response: fullResponse,
        chatId: sessionId,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({
      error: 'Failed to process chat request',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// AI Chat endpoint - compatible with the original functionality
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, chatId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Messages array is required',
        example: {
          messages: [{ role: 'user', content: 'Hello!' }],
          chatId: 'optional-chat-id'
        }
      });
    }

    // Generate chatId if not provided
    const sessionId = chatId || `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Convert messages to LangChain format
    const langchainMessages = aiService.convertToLangChainMessages(messages);

    console.log(`🔄 Processing chat request for session: ${sessionId}`);
    console.log(`📝 Messages count: ${messages.length}`);

    // Check if streaming is requested
    const shouldStream = req.headers.accept === 'text/event-stream' || req.query.stream === 'true';

    if (shouldStream) {
      // Set headers for Server-Sent Events
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const stream = await aiService.submitQuestion(langchainMessages, sessionId);

      let fullResponse = '';

      for await (const chunk of stream) {
        if (chunk.event === 'on_chat_model_stream' && chunk.data?.chunk?.content) {
          // Handle both string content and content arrays  
          const content = chunk.data.chunk.content;
          let textContent = '';
          
          if (typeof content === 'string') {
            textContent = content;
          } else if (Array.isArray(content)) {
            content.forEach(item => {
              if (typeof item === 'string') {
                textContent += item;
              } else if (item?.text) {
                textContent += item.text;
              }
            });
          }
          
          if (textContent) {
            fullResponse += textContent;
            
            // Send chunk to client
            res.write(`data: ${JSON.stringify({ 
              type: 'chunk', 
              content: textContent,
              chatId: sessionId 
            })}\n\n`);
          }
        }
      }

      // Send final message
      res.write(`data: ${JSON.stringify({ 
        type: 'done', 
        fullResponse,
        chatId: sessionId 
      })}\n\n`);
      
      res.end();
    } else {
      // Non-streaming response
      const stream = await aiService.submitQuestion(langchainMessages, sessionId);
      
      let fullResponse = '';
      let toolCalls = [];

      for await (const chunk of stream) {
        if (chunk.event === 'on_chat_model_stream' && chunk.data?.chunk?.content) {
          // Handle both string content and content arrays
          const content = chunk.data.chunk.content;
          if (typeof content === 'string') {
            fullResponse += content;
          } else if (Array.isArray(content)) {
            content.forEach(item => {
              if (typeof item === 'string') {
                fullResponse += item;
              } else if (item?.text) {
                fullResponse += item.text;
              }
            });
          }
        }
        if (chunk.event === 'on_chat_model_stream' && chunk.data?.chunk?.tool_calls) {
          toolCalls.push(...chunk.data.chunk.tool_calls);
        }
      }

      res.json({
        success: true,
        response: fullResponse,
        chatId: sessionId,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({
      error: 'Failed to process chat request',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple message endpoint (backward compatibility)
app.post('/api/messages', async (req, res) => {
  try {
    const { message, chatId } = req.body;
    
    if (!message) {
      return res.status(400).json({
        error: 'Message is required'
      });
    }

    console.log('📨 Modtaget besked:', message);

    // Brug eksisterende chatId eller generer en ny
    const sessionId = chatId || `simple_${Date.now()}`;
    
    // Hent eksisterende session historik
    const sessionHistory = sessionManager.getSessionHistory(sessionId);
    
    // Tilføj den nye brugerbesked
    const userMessage = { role: 'user', content: message };
    const combinedMessages = [...sessionHistory, userMessage];

    // Convert simple message to chat format
    const langchainMessages = aiService.convertToLangChainMessages(combinedMessages);
    
    const stream = await aiService.submitQuestion(langchainMessages, sessionId);

    let fullResponse = '';
    for await (const chunk of stream) {
      if (chunk.event === 'on_chat_model_stream' && chunk.data?.chunk?.content) {
        // Handle both string content and content arrays
        const content = chunk.data.chunk.content;
        if (typeof content === 'string') {
          fullResponse += content;
        } else if (Array.isArray(content)) {
          // Handle content array format
          content.forEach(item => {
            if (typeof item === 'string') {
              fullResponse += item;
            } else if (item?.text) {
              fullResponse += item.text;
            }
          });
        }
      }
    }

    // Clean up any JSON artifacts at the beginning
    fullResponse = fullResponse.replace(/^{"index":\d+,"type":"text","text":""}/, '').trim();

    // If we didn't get any response, provide a fallback
    if (!fullResponse) {
      fullResponse = "Jeg kunne ikke generere et svar. Prøv venligst igen.";
    }

    // Gem brugerbesked og AI-svar i session historikken
    sessionManager.addToSessionHistory(sessionId, [
      userMessage, 
      { role: 'assistant', content: fullResponse }
    ]);

    res.json({
      success: true,
      message: 'Besked modtaget og behandlet',
      response: fullResponse,
      received: message,
      chatId: sessionId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Message processing error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Noget gik galt!',
    message: err.message
  });
});

// 404 handler - Opdateret til at tjekke om det er et API-kald
app.use((req, res) => {
  // Hvis det er et API-kald, returner JSON fejl
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'API endpoint ikke fundet',
      path: req.path
    });
  }
  
  // For alle andre stier, redirect til frontend (hvis den findes)
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    res.redirect('/');
  } else {
    res.status(404).json({
      error: 'Endpoint ikke fundet',
      path: req.path
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server kører på port ${PORT}`);
  console.log(`📡 API tilgængelig på: http://localhost:${PORT}/api`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Chat endpoint: http://localhost:${PORT}/api/chat`);
  console.log(`📝 Messages endpoint: http://localhost:${PORT}/api/messages`);
  
  // Vis frontend URL kun hvis den er tilgængelig
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    console.log(`🌐 Frontend tilgængelig på: http://localhost:${PORT}`);
  }
  
  // Check environment variables
  console.log('\n🔍 Environment Check:');
  console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`WXFLOWS_ENDPOINT: ${process.env.WXFLOWS_ENDPOINT || '❌ Not set'}`);
  console.log(`WXFLOWS_API_KEY: ${process.env.WXFLOWS_API_KEY ? '✅ Set' : '❌ Missing'}`);
});

export const logger = {
  info: (message) => {
    console.log(message);
  },
  
  warn: (message) => {
    console.warn(message);
  },
  
  error: (message) => {
    console.error(message);
  },
  
  success: (message) => {
    originalConsoleLog(message);
    broadcastLog(message, 'success');
  },
  
  debug: (message) => {
    if (process.env.NODE_ENV === 'development') {
      originalConsoleLog(message);
      broadcastLog(message, 'debug');
    }
  },
  
  tool: (toolName, args, result = null) => {
    const message = result 
      ? `🛠️ Tool "${toolName}" completed: ${JSON.stringify(args, null, 2)}`
      : `🛠️ Tool "${toolName}" called: ${JSON.stringify(args, null, 2)}`;
    
    originalConsoleLog(message);
    broadcastLog(message, 'debug');
  }
};