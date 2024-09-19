import ProjectsHTMLInjector, { getRelativeTimeString } from 'main';
import { renderMarkdown } from './RenderTool';
import { ItemView, WorkspaceLeaf, App, IconName } from 'obsidian';
import {
	OpenAI,
	ClientOptions
} from "openai";
import { Chat, ChatCompletionChunk, ChatCompletionCreateParams } from 'openai/resources';
import { Stream } from 'openai/streaming';

export const VIEW_TYPE_CHAT = 'chat-view';

export class ChatView extends ItemView {
	app: App;
	plugin: ProjectsHTMLInjector;
	leaf: WorkspaceLeaf;
	private OPENAI_API_KEY: string;
	private openAiOptions: ClientOptions;
	private aiUsage: OpenAI.CompletionUsage;
	public promptTokens: number;
	public totalTokens: number;
	public openAI: OpenAI;
	public model: OpenAI.ChatModel;
	public models: OpenAI.Models;
	public chat: Chat;

	constructor(app: App, plugin: ProjectsHTMLInjector, leaf: WorkspaceLeaf) {
		super(leaf);
		this.app = app;
		this.plugin = plugin;
		this.leaf = leaf;
		this.OPENAI_API_KEY = this.plugin.settings.openaiApiKeySetting;
		this.openAiOptions = {
			apiKey: this.OPENAI_API_KEY,
			dangerouslyAllowBrowser: true,
		};
		this.openAI = new OpenAI(this.openAiOptions);
		this.promptTokens = 0;
		this.totalTokens = 0;
		this.model = "chatgpt-4o-latest";
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return "Chat View";
	}

	getIcon(): IconName {
		return "brain";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl("h4", { text: "Chat with GPT" });

		const mainContainer = container.createEl("div", {
			cls: "main-container",
		});
		const chatInterface = mainContainer.createEl("div", {
			cls: "chat-interface",
		});
		const chatLog = chatInterface.createEl("div", { cls: "chat-log" });
		const chatInputContainer = mainContainer.createEl("div", { cls: "control-container" });
		const chatInput = chatInputContainer.createEl("textarea", {
			cls: "chat-input",
		});
		const sendButton = chatInputContainer.createEl("button", {
			text: "Send",
			cls: "chat-send-button",
		});
		// Apply styles to make the input box bigger and fixed to the bottom
		mainContainer.setCssStyles({
			'display': 'flex',
			'flexDirection': 'column',
			'height': '100%',
			'width': '100%',
			'gap': '5px'
		});



		//chatInputContainer.append(chatInput, sendButton);
		mainContainer.append(chatInterface, chatInputContainer);
		sendButton.addEventListener("click", async () => {
			const userMessage = chatInput.value;
			if (userMessage.trim() === "") return;

			chatLog.createEl("h3", { text: "YOU" });
			const userMsgDiv = chatLog.createEl("div", {
				text: "",
				cls: "chat-message user-message",
			});
			userMsgDiv.innerHTML = await renderMarkdown(
				userMessage,
				this.plugin
			);
			chatInput.value = "";

			chatLog.createEl("h3", { text: this.model.toUpperCase() });
			await this.getChatResponse(userMessage, chatLog);
		});

		chatInput.onkeyup = async (event: KeyboardEvent) => {
			const key = event.key;
			if (
				(key.toLowerCase() === "enter" ||
					key.toLowerCase() === "return") &&
				!event.shiftKey
			) {
				if (event.shiftKey) return;
				event.preventDefault();
				const userMessage = chatInput.value;
				if (userMessage.trim() === "") return;

				chatLog.createEl("h3", { text: "YOU" });
				const userMsgDiv = chatLog.createEl("div", {
					text: "",
					cls: "chat-message user-message",
				});
				userMsgDiv.innerHTML = await renderMarkdown(
					userMessage,
					this.plugin
				);
				chatInput.value = "";

				chatLog.createEl("h3", { text: this.model.toUpperCase() });
				await this.getChatResponse(userMessage, chatLog);
			}
		};
	}

	async getChatResponse(message: string, chatLog: HTMLElement) {
		const params: ChatCompletionCreateParams = {
			model: this.model,
			messages: [{ role: "user", content: message }],
			frequency_penalty: 0.5,
			presence_penalty: 0.5,
			max_completion_tokens: null,
			temperature: 0.7,
			top_p: 1,
			n: 1,
			stream: true,
			stop: ["fuck off"],
			seed: 0,
			stream_options: {
				include_usage: true,
			},
		};

		const response: Stream<ChatCompletionChunk> = await this.openAI.chat.completions.create(params);

		const reader = response.toReadableStream().getReader();
		const decoder = new TextDecoder();
		let gptMessage = '';
		const gptMessageElement = chatLog.createEl('div', { cls: 'chat-message gpt-message' });
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			try {
				const json = JSON.parse(chunk);
				const content = json.choices[0] && json.choices[0]?.delta ? json.choices[0].delta?.content : "";
				if (content != "undefined" && typeof content !== 'undefined') {
					//gptMessageElement.textContent += content;
					gptMessage += content;
					const renderedMessage = await renderMarkdown(gptMessage, this.plugin);
					gptMessageElement.innerHTML = renderedMessage;
				}
			} catch (error) {
				console.error("Error parsing JSON chunk:", error);
			}
		}
		//const finalRenderedMessage = await renderMarkdown(
		//	gptMessageElement.textContent as string,
		//	this.plugin
		//);
		//gptMessageElement.innerHTML = finalRenderedMessage;
	}

	async onClose() {
		// Nothing to clean up for now
	}
}
