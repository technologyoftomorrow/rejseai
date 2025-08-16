import { ChatAnthropic } from "@langchain/anthropic";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import wxflows from "@wxflows/sdk/langchain";
import { END, MemorySaver, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { SYSTEM_MESSAGE } from "../context/SystemMessage.js";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { AIMessage, HumanMessage, SystemMessage, trimMessages } from "@langchain/core/messages";

// Message trimmer for conversation management
const trimmer = trimMessages({
  maxTokens: 15,
  strategy: "last",
  tokenCounter: (msgs) => msgs.length,
  includeSystem: true,
  allowPartial: false,
  startOn: "human",
});

class AIService {
  constructor() {
    this.toolClient = null;
    this.tools = null;
    this.toolNode = null;
    this.checkpointer = new MemorySaver();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      console.log('🔧 Initializing AI Service...');
      
      // Connect to wxflows
      this.toolClient = new wxflows({
        endpoint: process.env.WXFLOWS_ENDPOINT || "",
        apikey: process.env.WXFLOWS_API_KEY,
      });

      console.log('🔗 Connected to wxflows');

      // Retrieve the tools
      this.tools = await this.toolClient.lcTools;
      console.log(`🛠️ Loaded ${this.tools.length} tools:`, this.tools.map(t => t.name));
      
      // Create enhanced tool node with logging
      this.toolNode = new ToolNode(this.tools.map(tool => {
        // Wrap each tool with logging
        const originalCall = tool.call.bind(tool);
        tool.call = async (input, config) => {
          console.log(`🔧 Tool "${tool.name}" called with input:`, JSON.stringify(input, null, 2));
          
          try {
            const result = await originalCall(input, config);
            console.log(`✅ Tool "${tool.name}" returned:`, JSON.stringify(result, null, 2));
            return result;
          } catch (error) {
            console.log(`❌ Tool "${tool.name}" failed:`, {
              message: error.message,
              request: error.request,
              response: error.response
            });
            throw error;
          }
        };
        return tool;
      }));
      
      this.initialized = true;
      console.log('✅ AI Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize AI Service:', error.message);
      console.error('Full error:', error);
      // Fallback: continue without tools
      this.tools = [];
      this.toolNode = new ToolNode([]);
      this.initialized = true;
      console.log('⚠️ Continuing without tools');
    }
  }

  createModel() {
    console.log(`🤖 Creating model with ${this.tools.length} tools`);
    
    const model = new ChatAnthropic({
      model: "claude-3-5-sonnet-latest",
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxTokens: 8192,
      temperature: 0,
      streaming: true,
      clientOptions: {
        defaultHeaders: {
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
      },
      callbacks: [
        {
          handleLLMStart: async () => {
            console.log("🚀 Starting LLM call");
          },
          handleLLMEnd: async (output) => {
            console.log("✅ End LLM call");
            const usage = output.llmOutput?.usage;
            
            if (usage) {
              console.log("📊 Token Usage:", {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                total_tokens: usage.input_tokens + usage.output_tokens,
                cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
                cache_read_input_tokens: usage.cache_read_input_tokens || 0,
              });
            }
          },
        },
      ],
    }).bindTools(this.tools);

    console.log(`🔗 Model bound with tools: ${this.tools.map(t => t.name).join(', ')}`);
    return model;
  }

  // Function that defines whether the AI should continue the flow or not
  shouldContinue(state) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];

    console.log(`🔄 shouldContinue check - Last message type: ${lastMessage._getType()}`);
    console.log(`🔧 Tool calls: ${lastMessage.tool_calls?.length || 0}`);

    // If the LLM makes a tool call, then we route to the "tools" node
    if (lastMessage.tool_calls?.length) {
      console.log(`🛠️ Routing to tools: ${lastMessage.tool_calls.map(tc => tc.name).join(', ')}`);
      
      // Log the exact tool call details
      lastMessage.tool_calls.forEach((toolCall, index) => {
        console.log(`🔍 Tool call ${index + 1}:`, {
          name: toolCall.name,
          args: toolCall.args,
          id: toolCall.id
        });
      });
      
      return "tools";
    }

    // If the last message is a tool message, route back to agent
    if (lastMessage.content && lastMessage._getType() === "tool") {
      console.log(`🔄 Routing back to agent from tool`);
      return "agent";
    }

    // Otherwise, we stop (ending the flow and send the reply to the user)
    console.log(`🛑 Ending conversation`);
    return END;
  }

  createWorkflow() {
    const model = this.createModel();

    const stateGraph = new StateGraph(MessagesAnnotation)
      .addNode("agent", async (state) => {
        // Create the system message content
        const systemContent = SYSTEM_MESSAGE;

        // Create the prompt template with system message and messages placeholder
        const promptTemplate = ChatPromptTemplate.fromMessages([
          new SystemMessage(systemContent, {
            cache_control: { type: "ephemeral" },
          }),
          new MessagesPlaceholder("messages"),
        ]);

        // Trim the messages to manage conversation history
        const trimmedMessages = await trimmer.invoke(state.messages);

        // Format the prompt with the current messages
        const prompt = await promptTemplate.invoke({ messages: trimmedMessages });

        // Get response from the model
        const response = await model.invoke(prompt);

        return { messages: [response] };
      })
      .addEdge(START, "agent")
      .addNode("tools", this.toolNode)
      .addConditionalEdges("agent", this.shouldContinue.bind(this))
      .addEdge("tools", "agent");

    return stateGraph;
  }

  addCachingHeaders(messages) {
  if (!messages.length) {
    return messages;
  }

  // Create a copy of messages to avoid mutating the original
  const cachedMessages = [...messages];
  let cacheControlCount = 0;
  const maxCacheBlocks = 3; // Begrænser til 3 da system message allerede har 1

  // Helper to add cache control
  const addCache = (message) => {
    if (cacheControlCount >= maxCacheBlocks) {
      console.log(`⚠️ Cache control limit reached (${maxCacheBlocks}), skipping message`);
      return false;
    }
    
    message.content = [
      {
        type: "text",
        text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        cache_control: { type: "ephemeral" },
      }
    ];
    cacheControlCount++;
    console.log(`✅ Added cache control to message (${cacheControlCount}/${maxCacheBlocks})`);
    return true;
  };

  // Cache the last message if possible
  if (cachedMessages.length > 0) {
    addCache(cachedMessages.at(-1));
  }

  // Find and cache the second-to-last human message if within limit
  if (cacheControlCount < maxCacheBlocks) {
    let humanCount = 0;
    for (let i = cachedMessages.length - 1; i >= 0; i--) {
      if (cachedMessages[i].role === 'user' || cachedMessages[i].role === 'human') {
        humanCount++;
        if (humanCount === 2) {
          addCache(cachedMessages[i]);
          break;
        }
      }
    }
  }

  console.log(`📊 Total cache control blocks used: ${cacheControlCount + 1} (including system message)`);
  return cachedMessages;
}

  async submitQuestion(messages, chatId) {
    await this.initialize();

    // Add caching headers to messages
    const cachedMessages = this.addCachingHeaders(messages);

    const workflow = this.createWorkflow();

    // Compile the workflow with checkpointer
    const app = workflow.compile({ checkpointer: this.checkpointer });

    // Run the graph and stream
    const stream = await app.streamEvents(
      {
        messages: cachedMessages,
      },
      {
        version: "v2",
        configurable: {
          thread_id: chatId,
        },
        streamMode: "messages",
        runId: chatId,
      }
    );

    return stream;
  }

  // Helper method to convert text messages to LangChain format
  convertToLangChainMessages(messages) {
    return messages.map(msg => {
      if (msg.role === 'user' || msg.role === 'human') {
        return new HumanMessage(msg.content);
      } else if (msg.role === 'assistant' || msg.role === 'ai') {
        return new AIMessage(msg.content);
      } else if (msg.role === 'system') {
        return new SystemMessage(msg.content);
      }
      // Default to HumanMessage if role is unclear
      return new HumanMessage(msg.content);
    });
  }
}

export default new AIService();