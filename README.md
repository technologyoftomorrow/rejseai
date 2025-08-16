# AI Chat Rejseguide 🛫

En intelligent dansk rejseguide chatbot bygget med **Claude AI**, **LangChain**, og **Node.js/Express**. Systemet hjælper brugere med at finde rejsetilbud og pakkerejser gennem naturlig samtale.

## ✨ Features

- 🤖 **AI-powered rejseguide** med Claude Sonnet 4
- 🛠️ **Værktøj integration** via wxflows (flyhotel, charterrejser, booking deals)
- 💬 **Session management** - gem og genoptag samtaler
- 📡 **Live terminal logs** - real-time development monitoring
- 🔄 **Streaming responses** - AI svar i real-time
- 📱 **Responsive design** - virker på desktop og mobile
- 🇩🇰 **Dansk fokus** - optimeret til danske rejsebehov

## 🚀 Screenshots

### Chat Interface med Live Logs
![Chat Interface](docs/screenshot-chat.png)

### Værktøj Integration
![Tool Integration](docs/screenshot-tools.png)

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- Anthropic API nøgle
- wxflows API nøgle

### Installation

```bash
# Clone repository
git clone https://github.com/DIT-BRUGERNAVN/ai-chat-rejseguide.git
cd ai-chat-rejseguide

# Install dependencies
npm install

# Opret .env fil
cp .env.example .env
# Rediger .env med dine API nøgler

# Start server
npm start
```

### Environment Variables

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
WXFLOWS_ENDPOINT=your_wxflows_endpoint
WXFLOWS_API_KEY=your_wxflows_api_key
PORT=3000
NODE_ENV=development
```

## 📖 Brug

1. **Start serveren**: `npm start`
2. **Åbn browser**: `http://localhost:3000`
3. **Chat med AI'en**: Spørg om rejser til forskellige destinationer
4. **Monitorér logs**: Se live terminal output i højre panel

### Eksempel samtaler
- *"Jeg vil gerne til Barcelona i marts"*
- *"Find mig en charterrejse til Thailand"*
- *"Hvad koster det at flyve til New York?"*

## 🏗️ Arkitektur

```
Frontend (HTML/JS) 
    ↓ HTTP/SSE
Express Server 
    ↓ LangChain
Claude AI + Tools 
    ↓ API calls
wxflows Rejse APIs
```

### Hovedkomponenter

- **AIService**: LangChain integration med Claude og værktøjer
- **SessionManager**: In-memory chat historik management
- **SystemMessage**: Intelligent rejseguide prompt engineering
- **Log Streaming**: Real-time terminal logs via Server-Sent Events

## 🛠️ API Endpoints

- `POST /api/chat` - Streaming/non-streaming chat
- `POST /api/messages` - Simple message endpoint
- `GET /api/session/:id` - Session info
- `GET /api/logs/stream` - Live log streaming (SSE)

## 📝 Development

### Log Levels
- `info` 📝 - General information
- `warn` ⚠️ - Warnings
- `error` ❌ - Errors
- `success` ✅ - Successful operations
- `debug` 🔧 - Debug information

### Adding New Tools
1. Registrer værktøj i wxflows
2. Opdater system prompt med værktøj information
3. Test værktøj integration

## 🤝 Contributing

1. Fork repository
2. Opret feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push til branch (`git push origin feature/amazing-feature`)
5. Opret Pull Request

## 📄 License

MIT License - se [LICENSE](LICENSE) fil for detaljer.

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com) for Claude AI
- [LangChain](https://langchain.com) for AI framework
- [wxflows](https://wxflows.com) for rejse værktøjer
- [rejsespejder.dk](https://rejsespejder.dk) for domain expertise

## 📞 Support