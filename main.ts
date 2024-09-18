import {
	App,
	Plugin,
	moment,
	Notice,
	TFile,
	TAbstractFile,
	Editor,
	PluginManifest,
	ItemView,
	WorkspaceLeaf,
	Menu,
	IconName,
	MarkdownView,
	Platform,
	Modal,
	TFolder
} from 'obsidian';
import { HTMLInjectSettings, Settings, DEFAULT_SETTINGS } from 'Settings';
import { SettingsTab } from 'SettingsTab';
import { type RequestParams, type WebFetcher, type WebResponse } from "TodoistFetcher";
import { PGPTool, logGpg } from 'utils/PgpTool';
import { RecentFileView } from 'utils/RecentFileView';
import { Task, TodoistApi } from '@doist/todoist-api-typescript';
import { config } from 'dotenv';
// import { FileAccessTracker } from 'utils/fileTracker';
import { TaskTracker, TaskModal, TaskViewer, UpcomingTask, LateTask } from 'utils/taskTracker';
import { renderMarkdown } from './utils/RenderTool';
// import DOMPurify from 'isomorphic-dompurify';


export const LeafType = <const> ['middle', 'left', 'right'];
export type WorkspaceLeafTypes = typeof LeafType[number];
export const TaskViewType = <const> ['task-view', 'task-view-side-bar', 'my-custom-view', 'my-custom-view-side-bar', 'pgp-view', 'recent-file-view'];
export type ItemViewTaskTypes = typeof TaskViewType[number];

function getWeekNumber(d: Date): number {
	// Create a copy of the date object
	const date: Date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	// Set to the nearest Thursday: current date + 4 - current day number
	date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7)); // Make Sunday's day number 7
	// Get first day of year
	const yearStart: Date = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	// Calculate full weeks to nearest Thursday
	const weekNo: number = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return weekNo;
}

// Function to format the date as YYYY-MM-DD
function formatDate(d: Date): string {
	const year: number = d.getFullYear();
	const month: string = String(d.getMonth() + 1).padStart(2, '0');
	const day: string = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function getRelativeTimeString(date: string) {
    const now = moment();
    const taskDate = moment(date);

    if (taskDate.isSame(now, 'day')) {
        return `TODAY ${taskDate.format('HH:mm')}`;
    } else if (taskDate.isSame(now.add(1, 'days'), 'day')) {
        return `TOMORROW ${taskDate.format('HH:mm')}`;
    } else if (taskDate.isSame(now, 'week')) {
        return `${taskDate.format('ddd')} ${taskDate.format('HH:mm')}`;
    } else if (taskDate.isSame(now.add(1, 'weeks'), 'week')) {
        return `NEXT WEEK ${taskDate.format('dddd')} ${taskDate.format('HH:mm')}`;
    } else {
        return taskDate.format('MMM DD, YYYY HH:mm');
    }
}

function svgToBase64(svgString: string) {
    const cleanedSvg = svgString.trim().replace(/\n/g, '').replace(/\r/g, '');
    const base64Encoded = btoa(cleanedSvg);
    return `data:image/svg+xml;base64,${base64Encoded}`;
}

export default class ProjectsHTMLInjector extends Plugin {
    app: App;
    settings: HTMLInjectSettings;
    event: Event;
    fetcher: WebFetcher;
    weekName: string;
    dayName: string;
    mainFileContainer: HTMLDivElement;
    // fileAccessTracker: FileAccessTracker;
    errorCount: number;
    taskTracker: TaskTracker;
    todoistApi: TodoistApi | undefined;
    todoistToken: string | undefined;
	updateInterval: number;
	lastUpdate: moment.Moment;
	nextUpdate: moment.Moment;
    todoistInitializor: TaskTracker | undefined;
    taskCreator: typeof TaskModal | undefined;
    taskViewer: typeof TaskViewer | undefined;
    initializationPromise: Promise<void>;
    timeSetter: NodeJS.Timer | null;
    isTiming: boolean = false;
	buttonDiv: Element | null;
	taskCard: HTMLElement | null;
	viewHeader: HTMLElement | null;
	taskView: typeof TaskView | TaskView | null = null;
	taskViewSideBar: TaskView | null = null;
	customView: ScratchPadView;
	pgpView: PGPTool;
	recentFileView: RecentFileView | typeof RecentFileView;
	gpgLog: typeof PGPTool;

    errorHandler: (
        errorMessage: string,
        errorName?: string,
        fileName?: string,
        stack?: string,
        eventPhase?: number,
        lineNo?: number,
        target?: EventTarget | null,
        eventType?: string
    ) => void;
    errorReporter: () => Promise<void>;

    constructor(app: App, manifest?: PluginManifest) {
        const mainManifest: PluginManifest = manifest ?? {
            id: "projects-html-addon",
            name: "Projects Customizer",
            author: "me",
            version: "1.0.0",
            minAppVersion: "0.15.0",
            description: "Modify the projects page."
        };
        super(app, mainManifest);
        this.app = app;
        this.settings = DEFAULT_SETTINGS;
        this.todoistToken = undefined;
        this.todoistApi = undefined;
        this.todoistInitializor = undefined;
        this.taskCreator = TaskModal;
        this.taskViewer = TaskViewer;
		this.taskView = TaskView;
		this.gpgLog = PGPTool;
		this.recentFileView = RecentFileView;

        this.initializationPromise = this.initializeAsync();
    }

    async initializeAsync() {
        console.log(`LOADING INJECTOR`);
        const settingsInit = new Settings(this);
        await settingsInit.loadSettings();
        this.addSettingTab(new SettingsTab(this.app, this));

		if (this.settings.nextUpdateTime === '') {
			this.settings.nextUpdateTime = moment(new Date()).format('YYYY-MM-DDTHH:mm');
			await this.saveSettings();
		}

        this.todoistToken = this.settings.apiKey !== '' ? this.settings.apiKey : undefined;
		this.updateInterval = this.settings.updateInterval;
		this.nextUpdate = moment(this.settings.nextUpdateTime);

        if (!this.todoistToken) {
            const vaultRoot = (this.app.vault.adapter as any).basePath;
            const loadedEnv = config({ path: `${vaultRoot}/.env` });
            if (!loadedEnv.parsed) {
                console.error(`ENV CONFIG FAILURE:\n${loadedEnv?.error}`);
			} else if (this.isMobile() && loadedEnv.parsed?.TODOIST_API_KEY) {
				console.log(`LOADING NORMAL ENV: ${loadedEnv.parsed}`);
				this.todoistToken = loadedEnv.parsed.TODOIST_API_KEY;
            } else if (!this.isMobile()) {
				console.log(`LOADING NON-MOBILE ENV: ${loadedEnv.parsed}`);
                this.todoistToken = process.env?.TODOIST_API_KEY;
            } else {
				throw new Error(`ERROR OBTAINING API KEY: ${loadedEnv.parsed}`);
			}
			if (this.todoistToken) {
				this.todoistApi = new TodoistApi(this.todoistToken);
            	this.settings.apiKey = this.todoistToken;
			}
        }
        try {
            if (!this.todoistToken || this.todoistToken === '') {
                console.error(`Todoist API Key not found. Store it within .env in the vault root or set the API key in the plugin settings.`);
            } else {
				
				// Determine if an update is necessary
				if (moment().isAfter(this.nextUpdate)) {
					// Update nextUpdateTime for future checks
					this.settings.nextUpdateTime = moment().add(this.updateInterval, 'minutes').format('YYYY-MM-DDTHH:mm');
					await this.saveSettings();
					this.nextUpdate = moment(this.settings.nextUpdateTime);
					this.todoistInitializor = new TaskTracker(this.app, this, this.todoistToken); // Reset and initialize new tracker
					await this.todoistInitializor.apiGrabber();
				} else {
					this.todoistInitializor = new TaskTracker(this.app, this, this.todoistToken); // Continue using existing tracker
					await this.todoistInitializor.apiGrabber(); // Fetch using current settings
				}
			}
		} catch (err) {
			console.error(`API FAILED: ${err.name}, ${err.message}\n${err?.stack}`);
		}
    }

    async onload() {
        await this.initializationPromise;
		this.taskCard = null;
		this.buttonDiv = null;
		this.viewHeader = null;
		const date = new Date();
		const weekNum: number = getWeekNumber(date);
		const dayResult: string = formatDate(date);
		const lastSunday = moment(dayResult).clone().startOf('week').format('YYYY-MM-DD');
		const weekResult = `W${weekNum}-${lastSunday}`;

		this.weekName = weekResult;
		this.dayName = dayResult;
		this.errorCount = 0; // Initialize error handling properties

		// Set up error handling
		//this.errorHandler = (
		//	errorMessage: string,
		//	errorName?: string,
		//	fileName?: string,
		//	stack?: string,
		//	eventPhase?: number,
		//	lineNo?: number,
		//	target?: EventTarget | null,
		//	eventType?: string
		//) => {
		//	this.fileAccessTracker.totalErrors = this.errorCount;
		//	this.fileAccessTracker.handleError(errorMessage, errorName, fileName, stack, eventPhase, lineNo, target, eventType);
		//};

        this.registerEvent(this.app.workspace.on('file-open', await this.ensureCustomMenu.bind(this)));
        this.registerEvent(this.app.workspace.on('layout-change', await this.ensureCustomMenu.bind(this)));

		//this.fileAccessTracker = new FileAccessTracker(this.app, this);
        // Wrap loading actions in promises and await them
        //try {
        //    await Promise.all([
        //        this.fileAccessTracker.loadFileAccessData(),
        //        this.fileAccessTracker.loadFileArchiveData(),
        //        this.fileAccessTracker.loadFileDeletionData(),
		//		this.ensureCustomMenu()
        //    ]);
        //    this.errorReporter = this.fileAccessTracker.handleAllErrors.bind(this.fileAccessTracker);
//
        //    // Add event listener for global errors
        //    addEventListener('error', (ev: ErrorEvent) => {
		//		this.errorCount++;
        //        this.errorHandler(ev.message, '', ev.filename,'', ev.eventPhase, ev.lineno, ev.target, ev.type)
        //    });
//
		//	if (this.errorCount > 0) {
		//		// Call handleAllErrors after all actions are complete
		//		await this.errorReporter();
		//	}
        //} catch (err) {
        //    console.error('Failed to load data or handle errors:', err);
        //}
		await this.ensureCustomMenu();

        // Inject the HTML on initial load
        // this.injectHtml();
        // Re-inject the HTML when the layout changes (e.g., when a note is opened)
        // this.registerEvent(this.app.workspace.on('layout-change', this.injectHtml.bind(this)));

		this.viewHeader = document.createElement('div');
		if (this.buttonDiv && this.taskCard) this.viewHeader.append(this.buttonDiv, this.taskCard);
		this.viewHeader.style.display = 'flex';
		this.viewHeader.style.alignItems = 'center';

		this.registerView('task-view', (leaf) => {
			this.taskView = new TaskView(leaf, this, this.viewHeader as HTMLElement, 'task-view');
			return this.taskView;
		});
		this.registerView('task-view-side-bar', (leaf) => {
			this.taskView = new TaskView(leaf, this, this.viewHeader as HTMLElement, 'task-view-side-bar');
			return this.taskView;
		});
		this.registerView('my-custom-view', (leaf) => {
			this.customView = new ScratchPadView(leaf, this, 'my-custom-view');
			return this.customView;
		});
		this.registerView('my-custom-view-side-bar', (leaf) => {
			this.customView = new ScratchPadView(leaf, this, 'my-custom-view-side-bar');
			return this.customView;
		});
		this.registerView('pgp-tool', (leaf) => {
			this.pgpView = new PGPTool(this.app, this, leaf);
			return this.pgpView;
		});
		this.registerView('recent-file-view', (leaf) => {
			this.recentFileView = new RecentFileView(this.app, this, leaf);
			return this.recentFileView;
		});

		this.addCommand({
			id: 'toggle-block-comment',
			name: 'Toggle Block Comment',
			editorCallback: (editor: Editor) => {
				const commentedLineHolder = [];
				const selection = editor.getSelection().split('\n');
				for (const line of selection) {
					const commentedLine = line.replace(line, `//${line}`);
					commentedLineHolder.push(commentedLine);
				}
				const selectionReplacement = commentedLineHolder.join('\n');
				editor.replaceSelection(selectionReplacement);
			}
		});
		this.addCommand({
			id: 'untoggle-block-comment',
			name: 'Untoggle Block Comment',
			editorCallback: (editor: Editor) => {
				const selection = editor.getSelection();
				const selectionReplacement = selection.replace(/^\/\//gm, '');
				editor.replaceSelection(selectionReplacement);
			}
		});

		this.addCommand({
			id: 'activate-task-view',
			name: 'Open Task View',
			callback: async () => {
				const viewLocations: WorkspaceLeafTypes[] = ['middle', 'right'];
				const viewTypes: ItemViewTaskTypes[] = ['task-view', 'task-view-side-bar'];
				await this.activateView(viewTypes, true, viewLocations);
			}
		});
		this.addCommand({
			id: 'activate-task-view-right',
			name: 'Open Task View in Right Pane',
			callback: async () => {
				await this.activateView(['task-view-side-bar'], true, 'right');
			}
		});
		this.addCommand({
			id: 'activate-task-view-left',
			name: 'Open Task View in Left Pane',
			callback: async () => {
				await this.activateView(['task-view-side-bar'], true, 'left');
			}
		});
		this.addCommand({
			id: 'activate-custom-view',
			name: 'Activate Custom View',
			callback: async () => {
				const types: WorkspaceLeafTypes[] = ['middle', 'right'];
				const viewTypes: ItemViewTaskTypes[] = ['my-custom-view', 'my-custom-view-side-bar'];
				await this.activateView(viewTypes, true, types);
			}
		});
		this.addCommand({
			id: 'activate-recent-file-view',
			name: 'Activate Recent File View',
			callback: async () => {
				const types: WorkspaceLeafTypes[] = ['left'];
				const viewTypes: ItemViewTaskTypes[] = ['recent-file-view'];
				await this.activateView(viewTypes, true, types);
			}
		});
		this.addCommand({
			id: 'activate-pgp-view',
			name: 'Activate PGP View',
			callback: async () => {
				const leaf = this.app.workspace.getRightLeaf(false); // Get right leaf
				if (leaf) {
					//await this.pgpView.loadKeys();
					await leaf.setViewState({
						type: 'pgp-tool', // Ensure the type matches the registered view
						active: true,
					});
					this.app.workspace.revealLeaf(leaf); // Reveal the leaf to ensure visibility
				}
			}
		});
	}

	async onunload() {
        //removeEventListener('error', this.errorReporter);
	}

	async loadSettings() {
		this.settings = Object.assign({}, this.settings, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	injectHtml() {
		const file = this.app.workspace.getActiveFile();
		if (file && file.basename === 'Untitled') {
			if (!document.querySelector('#my-button')) {
				// Create a container for your HTML
				const container = document.createElement('div');
				container.className = 'my-custom-html-container';
				const containerH2 = document.createElement('h2');
				containerH2.textContent = 'My Persistent HTML';
				const containerP = document.createElement('p');
				containerP.textContent = 'This content is injected by MyCustomPlugin and will persist.';
				const containerBtn = document.createElement('button');
				containerBtn.id = 'my-button';
				containerBtn.textContent = 'Button 1';

				// Add your persistent HTML here
				container.appendChild(containerH2);
				container.appendChild(containerP);
				container.appendChild(containerBtn);

				document.querySelector(".markdown-source-view")?.prepend(container);

				container.querySelector('#my-button')?.addEventListener('click', () => {
					alert('Button clicked!');
				});
			}

			if (!document.querySelector('#my-buttonTwo')) {
				const containerTwo = document.createElement('div');
				containerTwo.className = 'my-custom-html-container2';
				const containerTwoH2 = document.createElement('h2');
				containerTwoH2.textContent = 'My Persistent HTML';
				const containerTwoP = document.createElement('p');
				containerTwoP.textContent = 'This content is injected by MyCustomPlugin and will persist.';
				const containerTwoBtn = document.createElement('button');
				containerTwoBtn.id = 'my-buttonTwo';
				containerTwoBtn.textContent = 'Button 2';

				// Add your persistent HTML here
				containerTwo.appendChild(containerTwoH2);
				containerTwo.appendChild(containerTwoP);
				containerTwo.appendChild(containerTwoBtn);

				document.querySelector(".markdown-preview-view")?.prepend(containerTwo);

				containerTwo.querySelector('#my-buttonTwo')?.addEventListener('click', () => {
					alert('Button clicked!');
				});
			}
		}
	}

	addLeafToCollection(position: string, leaves: Set<WorkspaceLeaf>) {
		switch (position) {
			case 'left':
				const leftLeaf = this.app.workspace.getLeftLeaf(false);
				if (leftLeaf) leaves.add(leftLeaf);
				break;
			case 'right':
				const rightLeaf = this.app.workspace.getRightLeaf(false);
				if (rightLeaf) leaves.add(rightLeaf);
				break;
			case 'middle':
				const middleLeaf = this.app.workspace.getLeaf('tab');
				if (middleLeaf) leaves.add(middleLeaf);
				break;
			default:
				console.warn(`Invalid leaf position: ${position}`);
				break;
		}
	}

	async activateView(
		viewTypes: ItemViewTaskTypes[],
		active: boolean = true,
		leafPosition: WorkspaceLeafTypes[] | 'left' | 'right' | 'middle' = 'middle'
	): Promise<void> {
		let leaves: WorkspaceLeaf[] | Set<WorkspaceLeaf> = new Set();
		for (let index = 0; index < viewTypes.length; index++) {
			const viewType = viewTypes[index];
			const existingLeaf = await this.getOrCreateLeaf(viewType);

			if (existingLeaf) {
				existingLeaf.setViewState({
					type: viewType,
					active: active
				});
				continue;
			} else {
				this.addLeafToCollection( typeof leafPosition === 'string' ? leafPosition : leafPosition[index], leaves);
				Array.from(leaves).filter(Boolean).forEach(leaf => {
					leaf.setViewState({
						type: viewType,
						active: active
					});
				});
			}
		}
	}

	async getOrCreateLeaf(viewType: string): Promise<WorkspaceLeaf | null> {
		return this.app.workspace.getLeavesOfType(viewType)[0] ?? null;
	}

	async quickViewState() {
		try {
			const leaf = this.app.workspace.getLeaf();
			if (!leaf) return '';
			const state = await leaf.getViewState().state;
			return state.mode;
		} catch (err) {
			//this.errorHandler(err.name, err.message, err?.stack);
			//this.errorCount += 1;
		}
	}

	async grabFrontMatter(target: string, value?: any, add: boolean = false, remove: boolean = false) {
		const currentFile = this.app.workspace.getActiveFile();
		if (currentFile) {
			let fmToGet: any;
			await this.app.fileManager.processFrontMatter(currentFile, (fm) => {
				const interest = fm[target] ?? null;
				if (add) fm[target] = value ?? '';
				else if (remove) delete fm[target];
				else {
					fmToGet = interest;
				}
			})
			return fmToGet;
		}
	}

	async openScrapNoteModal() {
		try {
			const notePath = 'Scratch-Pad.md'; // Set the path to your scrap note
			const TFileCreator = async (path: string) => {
				let newTFile = this.app.vault.getAbstractFileByPath(path);
				if (!(newTFile instanceof TAbstractFile) || !(newTFile instanceof TFile)) {
					newTFile = await this.app.vault.create(path, '');
					new Notice('Scrap note not found! Created a new one.');
					if (!(newTFile instanceof TFile) || !newTFile) throw new Error('CANT GET TFILE');
				}
				return newTFile;
			}
			let file: TFile = await TFileCreator(notePath);
			const content = await this.app.vault.read(file);

			// Create the modal elements
			const modalOverlay = document.createElement('div');
			modalOverlay.classList.add('scratchpad-modal-overlay');

			const modalContainer = document.createElement('div');
			modalContainer.classList.add('scratchpad-modal-container');

			const closeButton = document.createElement('button');
			closeButton.classList.add('scratchpad-modal-close-button');
			closeButton.innerText = 'Close';
			closeButton.onclick = async () => {
				// Save changes from the temporary file back to the original file
				const updatedContent = await this.app.vault.read(tempFile);
				await this.app.vault.modify(file, updatedContent);
				tempLeaf.detach();
				await this.app.vault.trash(tempFile, true);
				document.body.removeChild(modalOverlay);
			};

			// Create/Open a temporary file for Live Preview
			let tempFile: TFile;
			if (!(await this.app.vault.adapter.exists('temp-scratch-pad.md'))) {
				tempFile = await this.app.vault.create('temp-scratch-pad.md', content);
			}  else {
				tempFile = await TFileCreator('temp-scratch-pad.md');
			}

			// Create a new leaf and open the temporary file in Live Preview mode
			const tempLeaf = this.app.workspace.getLeaf('split', 'vertical');
			await tempLeaf.openFile(tempFile);
			tempLeaf.setViewState({
				type: 'markdown',
				state: {
					file: tempFile.path,
					mode: 'source',
					source: 'live-preview'
				}
			});

			const modalSetup = () => {
				const renderArea = tempLeaf.view.containerEl;
				modalContainer.appendChild(closeButton);
				modalContainer.appendChild(renderArea);
				modalOverlay.appendChild(modalContainer);
				document.body.appendChild(modalOverlay);

				// Ensure the textarea and render area are synchronized
				renderArea.style.display = 'block';

				const originalTitleCotainer = document.querySelector("body > div.scratchpad-modal-overlay > div > div");
				const originalTitle = originalTitleCotainer?.querySelector('.view-header');
				if (originalTitleCotainer && originalTitle) {
					originalTitleCotainer.removeChild(originalTitle); // remove the overhead menu
				}
			}
			modalSetup();
		} catch (err) {
			//this.errorHandler(err.name, err.message, err?.stack);
			//this.errorCount += 1;
		}
	}

	isMobile() {
		return Platform.isAndroidApp || Platform.isIosApp || Platform.isMobile || Platform.isMobileApp || Platform.isPhone || Platform.isTablet;
	}

	async addElementOnNoteOnLoad() {
		try {
			const vaultName = this.app.vault.getName();
			const weekURL = `obsidian://advanced-uri?vault=${vaultName}&filepath=${encodeURI(`Life Manager/Projects/Weekly Reviews/Reviews/${this.weekName}.md`)}`;
			const dayURL = `obsidian://advanced-uri?vault=${vaultName}&filepath=${encodeURI(`Daily Notes/${this.dayName}.md`)}`;
			const envURL = `obsidian://advanced-uri?vault=${vaultName}&filepath=${encodeURI('ENV.md')}`;
			const homeURL = `obsidian://advanced-uri?vault=${vaultName}&filepath=${encodeURI('Dashboard.md')}`;
			const openScrapNoteModal = async () => {
				await this.openScrapNoteModal();
			}
			// Create the custom menu elements
			const createCustomMenu = async (containerEl: HTMLElement | null, isNewTab?: boolean) => {
				const elements: HTMLElement[] = [];
				const isMobile = this.isMobile();
				if (!containerEl) {
					console.error(`CONTAINER EL WAS NULL`);	
					return;
				}
				let div = containerEl.querySelector('.center-container.topContainer');
				if (!div) {
					// Create a new div element
					div = document.createElement("div");
					div.classList.add('center-container', 'topContainer');
					this.buttonDiv = div;

					const trashElement = document.createElement('div');
					trashElement.classList.add('svg-iconCustom-small', 'trash');
					trashElement.ariaLabel = 'Delete the current file.';
					trashElement.onclick = async () => {
						const file = this.app.workspace.getActiveFile();
						const leaf = this.app.workspace.getLeaf();
						const confirmation = confirm('Are you sure you want to delete the current file?');
						if (confirmation && file) {
							await this.app.fileManager.trashFile(file);
							leaf.detach();
						} else {
							new Notice('File deletion cancelled. Bitch.');
						}
					}
					elements.push(trashElement);

					// Close file
					let closeElement = document.createElement('div');
					closeElement.classList.add('svg-iconCustom-small', 'close');
					closeElement.ariaLabel = 'Close the current file.';
					closeElement.onclick = async (ev: MouseEvent) => {
						const view = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.app.workspace.getActiveViewOfType(ItemView);
						if ((view as any).closeable) {
							(view as any).close();
							const leaf = (view as any).leaf;
							leaf.detach();
						} else if (this.app.workspace.getLeaf()) {
							this.app.workspace.getLeaf().detach();
						}
					}
					elements.push(closeElement);

					// Undo closed tab
					let undoElement = document.createElement('div');
					undoElement.classList.add('svg-iconCustom-small', 'undo');
					undoElement.ariaLabel = 'Reopen closed tab.';
					undoElement.onclick = async () => {
						const leafHolder = [];
						const activeLeaves = (this.app.workspace as any).activeTabGroup.children;
						// Collect currently opened files
						for (const leaf of activeLeaves) {
							const filePath = leaf.view.file?.path; // Use full path
							if (filePath) leafHolder.push(filePath);
						}
						const lastOpenedFiles = this.app.workspace.getLastOpenFiles();
						let file = null;
						let index = 0;
						// Find the first file in lastOpenedFiles that's not currently open
						while (index < lastOpenedFiles.length) {
							const lastOpened = lastOpenedFiles[index];
							if (!leafHolder.includes(lastOpened)) {
								file = lastOpened;
								break;
							}
							index++;
						}
						// If a valid file is found, open it in a new tab
						if (file) {
							const lastOpenedFile = this.app.vault.getAbstractFileByPath(file);
							if (lastOpenedFile instanceof TFile) {
								const newTab = this.app.workspace.getLeaf("tab");
								await newTab.openFile(lastOpenedFile);
							} else {
								console.log(`NOT A VALID TFILE: ${lastOpenedFile}`);
							}
						} else {
							new Notice("No closed tabs to reopen.");
						}
					}
					elements.push(undoElement);

					let viewElement: HTMLElement | null = null;
					if (!(isNewTab)) {
						// Create view switcher
						viewElement = document.createElement('div');
						const findView = await this.quickViewState();
						const viewCls = findView === 'preview' ? 'view-preview' : 'view-source';
						viewElement.classList.add('svg-iconCustom-small', `${viewCls}`);
						viewElement.onclick = async (ev: MouseEvent) => {
							const viewEl = viewElement as HTMLElement;
							const currentFile = this.app.workspace.getActiveViewOfType(MarkdownView);
							let currentState = currentFile?.getMode();
							const toolTip = currentState === 'preview' ? 'Switch to live preview mode.' : 'Switch to preview/reading mode.';
							(currentFile as any).toggleMode();
							viewEl.classList.toggle('view-source', currentState === 'preview');
							viewEl.classList.toggle('view-preview', currentState === 'source');
							viewEl.ariaLabel = toolTip;
						}
						if (!isMobile) viewElement.ariaLabel = findView === 'source' ? `Switch to preview/reading mode.` : `Switch to live preview mode.`;

						// Create refresh button
						let refreshButtonElement = document.createElement('a');
						refreshButtonElement.classList.add('svg-iconCustom-small', 'refresh');
						refreshButtonElement.addEventListener('click', async (ev: MouseEvent) => {
							(this.app.workspace?.getActiveViewOfType(MarkdownView)?.leaf as any).rebuildView();
						});
						refreshButtonElement.ariaLabel = "Reload the current page.";
						elements.push(refreshButtonElement);
					}

					// Create Scrap Pad Button
					const scrapNoteButton = document.createElement('a');
					scrapNoteButton.classList.add('svg-iconCustom-small', 'scrapnote');
					scrapNoteButton.addEventListener('click', async (ev: MouseEvent) => {
						await openScrapNoteModal();
					});
					scrapNoteButton.ariaLabel = "Make a quick note.";
					//if (!isMobile) elements.push(scrapNoteButton);
					elements.push(scrapNoteButton);

					// Create next due task element
					const closestTaskName = this.todoistInitializor?.finalTaskData.closestTaskName;
					let taskNameDisplay = closestTaskName;
					const taskNameIsLink = closestTaskName ? closestTaskName.match(/(?<=^\[).+(?=\]\(.+?\))/g) : false;
					if (taskNameIsLink) taskNameDisplay = taskNameIsLink[0];

					const closestTaskDate = this.todoistInitializor?.finalTaskData.closestTaskTime;
					const overdueTaskCount = this.todoistInitializor?.finalTaskData.overdueTaskCount;
					const upcomingTasks = this.todoistInitializor?.finalTaskData.upcomingTasks;
					let relativeTime = null;
					if (closestTaskDate) relativeTime = moment(closestTaskDate).fromNow(true); //getRelativeTimeString(closestTaskDate);
					
					const taskCard = document.createElement("div");
					taskCard.classList.add('task-card');

					const taskNameCard = document.createElement("div");
					taskNameCard.classList.add('card', 'task-name-card');
					taskNameCard.textContent = `🚨 ${taskNameDisplay} ⌛️ ${relativeTime}`;
					taskNameCard.ariaLabel = `Open Task:\n${this.todoistInitializor?.closestTaskName}`;
					taskNameCard.onclick = async () => {
						const todoistApi = new TodoistApi(this.todoistToken as string);
						if (this.taskViewer) {
							const task: Task = await todoistApi.getTask(this.todoistInitializor?.closestTaskId as string);
							new this.taskViewer(this.app, this, task).open();
						}
					}
					this.taskCard = taskCard;

					//const taskTimeCard = document.createElement("div");
					//taskTimeCard.classList.add('card', 'task-time-card');
					//taskTimeCard.textContent = `⌛️ ${relativeTime}`;

					const overdueCountCard = document.createElement("div");
					overdueCountCard.classList.add('card', 'overdue-count-card');
					let overDueEmoji = '🔔';
					let overDueColor = 'yellow';
					if (typeof overdueTaskCount === 'number' && overdueTaskCount > 0) {
						overDueColor = 'red';
						overDueEmoji = '🚨'
					} else if (typeof overdueTaskCount === 'number' && overdueTaskCount === 0) {
						overDueColor = 'green';
						overDueEmoji = '🎉';
					}
					overdueCountCard.textContent = `${overDueEmoji} ${overdueTaskCount} TASKS OVERDUE`;
					overdueCountCard.style.color = overDueColor;

					taskCard.appendChild(taskNameCard);
					// taskCard.appendChild(taskTimeCard);
					//if (!isMobile) taskCard.appendChild(overdueCountCard);
					taskCard.appendChild(overdueCountCard);
					// elements.push(taskCard) REMINDER

					const mainHomeElement = document.createElement('a');
					mainHomeElement.classList.add('svg-iconCustom-small', 'main-home');
					mainHomeElement.href = homeURL;
					mainHomeElement.ariaLabel = "Main dashboard.";
					elements.push(mainHomeElement);

					// Create ENV element
					const envLinkElement = document.createElement("a");
					envLinkElement.classList.add('svg-iconCustom-small', 'env');
					envLinkElement.href = envURL;
					envLinkElement.ariaLabel = "🤫 Secrets 🤐";
					//if (!isMobile) elements.push(envLinkElement);
					elements.push(envLinkElement);

					// Create the week link element
					const weekLinkElement = document.createElement("a");
					weekLinkElement.classList.add('svg-iconCustom-small', 'week');
					weekLinkElement.href = weekURL;
					weekLinkElement.ariaLabel = "This Week's Review";
					//if (!isMobile) elements.push(weekLinkElement);
					elements.push(weekLinkElement);

					// Create the day link element
					const dayLinkElement = document.createElement("a");
					dayLinkElement.classList.add('svg-iconCustom-small', 'day');
					dayLinkElement.href = dayURL;
					dayLinkElement.ariaLabel = "Today's Review";
					//if (!isMobile) elements.push(dayLinkElement);
					elements.push(dayLinkElement);
		
					// Create the tab-stacker element
					const tabStackerElement = document.createElement("div");
					tabStackerElement.classList.add('svg-iconCustom-small', 'stack-tabs');
					tabStackerElement.ariaLabel = "Toggle stacked tabs.";
					tabStackerElement.onclick = () => {
						((this.app as any).commands as any).executeCommandById("workspace:toggle-stacked-tabs");
					}
					//if (!isMobile) elements.push(tabStackerElement);
					elements.push(tabStackerElement);

					// Create the locked/unlocked-page element
					const lockOrUnlockElement = document.createElement("div");
					const currentCssClasses: string[] = await this.grabFrontMatter('cssclasses');
					const lockTypeCssClass = currentCssClasses?.includes('lockAll') ? 'lock-page' : 'unlock-page';
					lockOrUnlockElement.classList.add('svg-iconCustom-small', `${lockTypeCssClass}`);
					lockOrUnlockElement.ariaLabel = "Lock or unlock page editing.";
					lockOrUnlockElement.onclick = async () => {
						const activeFile = this.app.workspace.getActiveFile();
						if (activeFile) {
							let fileCssClasses = await this.grabFrontMatter('cssclasses') ?? await this.grabFrontMatter('cssclasses', [], true);
							const shouldLock = !fileCssClasses?.includes('lockAll');

							// Update the UI immediately
							lockOrUnlockElement.classList.toggle('lock-page', shouldLock);
							lockOrUnlockElement.classList.toggle('unlock-page', !shouldLock);

							// Now update the frontmatter asynchronously
							await this.app.fileManager.processFrontMatter(activeFile, (fm) => {
								if (!shouldLock) {
									fm['cssclasses'] = fm['cssclasses'].filter((cls: string) => cls !== 'lockAll');
								} else {
									fm['cssclasses'].push('lockAll');
								}
							});
						}
					};
					//if (!isMobile) elements.push(lockOrUnlockElement);
					elements.push(lockOrUnlockElement);

					const taskViewElement = document.createElement('div');
					taskViewElement.classList.add('svg-iconCustom-small', 'task-view');
					taskViewElement.onclick = async () => {
						await this.activateView(['task-view', 'task-view-side-bar'], true, ['middle', 'right']);
					}
					taskViewElement.ariaLabel = 'Open the Task View.';
					elements.push(taskViewElement);

					if (viewElement) elements.push(viewElement);

					for (const el of elements) {
						div.appendChild(el);
					}

					containerEl.setCssStyles({
						'whiteSpace': 'nowrap',
						'overflow': 'auto'
					});

					if (isMobile) {
						//console.log('Loading for mobile device...');
						const mobileWorkaround = document.createElement('div');
						mobileWorkaround.id = 'mobile-div';
						mobileWorkaround.setCssStyles({
							'display': 'flex',
							'flexDirection': 'column',
						});
						mobileWorkaround.append(taskCard, div);
						containerEl.prepend(mobileWorkaround);
					} else {
						containerEl.prepend(taskCard, div);
					}
				}
			}
			const injectCustomMenu = async () => {
				// const activeLeaf = this.app.workspace.getLeaf()?.view.containerEl ?? this.app.workspace.getActiveViewOfType(ItemView);
				const activeLeaf = this.app.workspace.activeLeaf;
				const isNewTab = activeLeaf?.view.containerEl.querySelector('.empty-state') !== null;
				const container = activeLeaf?.view.containerEl.querySelector('.view-header') as HTMLElement | null;
				if (container) await createCustomMenu(container, isNewTab);
				else console.log('container not found');
			}
			await injectCustomMenu();

		} catch (err) {
			//this.errorHandler(err.name, err.message, err?.stack);
			//this.errorCount += 1;
		}
	}

	async ensureCustomMenu() {
		const headerQuery2 = this.app.workspace.activeLeaf?.view.containerEl.querySelector('.view-header') as HTMLElement | null;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.app.workspace.getActiveViewOfType(ItemView);
		let headerQuery = view?.containerEl.querySelector('.view-header') as HTMLElement | null;

		if (headerQuery) {
			await this.todoistInitializor?.apiGrabber();
			const buttonMenuQuery = headerQuery.querySelector('.center-container.topContainer');
			// Check if the custom menu is already present; if not, add it
			if (!buttonMenuQuery) {
				//console.log(`INSTALLING BUTTON MENU`)
				await this.addElementOnNoteOnLoad();
			}
			const taskCardQuery = headerQuery?.querySelector('.task-card');
			if (taskCardQuery) { // Clear existing task card, if present, for dynamic updates to header task info
				taskCardQuery.remove();
			}
			// Inject or update the task card with the latest data
			if (this.todoistToken) {
				let taskData;
				if (this.todoistInitializor) {
					taskData = this.todoistInitializor?.finalTaskData
				} else {
					const taskDataOrigin = new TaskTracker(this.app, this, this.todoistToken);
					await taskDataOrigin.apiGrabber(true);
					taskData = taskDataOrigin.finalTaskData;
				}
				const closestTaskName = taskData.closestTaskName ?? 'None';
				const closestTaskTime = taskData.closestTaskTime ?? 'N/A';
				const overdueTaskCount = taskData.overdueTaskCount ?? 0;
				const relativeTime = closestTaskTime !== 'N/A' ? getRelativeTimeString(closestTaskTime) : 'N/A';
				const taskCard = document.createElement("div");
				taskCard.classList.add('task-card');
				taskCard.innerHTML = `
					<div class="card task-name-card">🚨 ${closestTaskName} ⌛️ ${relativeTime}</div>
					<div class="card overdue-count-card" style="color: ${overdueTaskCount > 0 ? 'red' : 'green'};">
						${overdueTaskCount > 0 ? '🚨' : '🎉'} ${overdueTaskCount} TASKS OVERDUE
					</div>
				`;
				
				if (!this.isMobile()) {
					headerQuery?.prepend(taskCard);
				} else {
					const mobileQuery = view?.containerEl.querySelector('#mobile-div') as HTMLElement | null;
					if (mobileQuery) {
						//console.log(`MOBILE QUERY SUCCESS: ` + mobileQuery);
						mobileQuery.appendChild(taskCard);
					}
				}
			}
		}
		// Ensure there's no duplicate custom menu
		const newHeaderQuery = this.app.workspace.activeLeaf?.view.containerEl.querySelector('.view-header');
		const duplicateButtonMenus = newHeaderQuery?.querySelectorAll('.center-container.topContainer');
		const duplicateTaskCards = newHeaderQuery?.querySelectorAll('.task-card');
		const isDuplicates = duplicateButtonMenus && duplicateButtonMenus.length > 1 || duplicateTaskCards && duplicateTaskCards.length > 1;
		if (isDuplicates) {
			if (duplicateButtonMenus && duplicateButtonMenus?.length > 1) {
				const allBtnMenus = Array.from(duplicateButtonMenus);
				for (let i = 1; i < allBtnMenus.length; i++) allBtnMenus[i].remove();
			}
			if (duplicateTaskCards && duplicateTaskCards?.length > 1) {
				const allTaskCards = Array.from(duplicateTaskCards);
				for (let i = 1; i < allTaskCards.length; i++) allTaskCards[i].remove();
			}
		}
	}


}

/**
 * Credit to @todoist-plugin
 */
export class TodoistApiError extends Error {
	public statusCode: number;
	
	constructor(request: RequestParams, response: WebResponse) {
		const message = `[${request.method}] ${request.url} returned '${response.statusCode}: ${response.body}`;
		super(message);
		this.statusCode = response.statusCode;
	}
}

    // startTaskCycle(element: Element) {
	// 	const taskData = this.taskData;
	// 	const currentTask = this.currentTask;
    //     let currentIndex = 0;

	// 	setInterval(() => {
	// 		element.classList.add('fade-out');
	// 		setTimeout(() => {
	// 			currentIndex = (currentIndex + 1) % Object.entries(taskData).length;
	// 			const taskName = taskData[currentIndex]?.content;
	// 			const taskDate = taskData[currentIndex]?.due?.datetime
	// 				? taskData[currentIndex]?.due?.datetime
	// 				: (taskData[currentIndex]?.due?.date ? taskData[currentIndex]?.due?.date : 'None');
	// 			const overdueTaskCount = currentTask.overdueCount;
	// 			const taskString = `NEXT TASK: ${taskName} @ ${taskDate} | ${overdueTaskCount} TASKS OVERDUE`;
	// 			element.textContent = taskString;
	// 			element.classList.remove('fade-out');
	// 		}, 500); // Wait for fade-out transition before changing text // ya 
	// 	}, 5000); // Change task every 5 seconds
    // }

	// async renderMarkdown(content: string, container: HTMLElement, sourcePath: string, component: Component) {
	// 	container.innerHTML = ''; // Clear previous content
	// 	MarkdownRenderer.render(this.app, content, container, sourcePath, component);
	// }

function hashString(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

export function generateCheckboxKey(text: string): string {
    const hash = hashString(text);
    return `${hash}-${text.replace(/\W+/g, '-').toLowerCase()}`;
}

declare global {
    interface Window {
        updateCheckboxState: (checkbox: HTMLInputElement) => void;
    }
}


export class ScratchPadView extends ItemView {
	app: App;
	plugin: ProjectsHTMLInjector;
	container: HTMLElement;
	viewType: ItemViewTaskTypes;
	eventListeners: any[];
	copyButtons: any[];
	textArea: HTMLTextAreaElement;
	private debouncedKeyUpHandler: (event: KeyboardEvent) => void;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectsHTMLInjector, viewType: ItemViewTaskTypes) {
		super(leaf);
		this.plugin = plugin;
		this.viewType = viewType;
		this.eventListeners = [];
		this.copyButtons = [];
	}

	getViewType() {
		return this.viewType;
	}

	getDisplayText() {
		return 'My Custom View';
	}

	getIcon() {
		return 'lightbulb';
	}

	async onOpen() {
		const { containerEl } = this;

		this.container = containerEl;  // .children[1] as HTMLElement;
		this.container.empty();
		this.container.setAttr('data-type', 'my-custom-view');
		window.updateCheckboxState = await this.updateCheckboxState.bind(this);

		const btnContainer = this.container.createDiv();
		const toggleButton = this.container.createEl('button', { text: 'Toggle View' });
		const toggleStatusBar = this.container.createEl('button', { text: 'Toggle Status Bar' });
		const toggleVaultBar = this.container.createEl('button', { text: 'Toggle Vault Bar' });
		const copyContent = this.container.createEl('button', { text: 'Copy Content' });
		const clearContent = this.container.createEl('button', { text: 'Clear Content' });
		const openInMainView = this.container.createEl('button', { text: 'Open in Main View' });
		const saveScratchPadContent = this.container.createEl('button', { text: 'Save as...' });
		const exportScratchPadContent = this.container.createEl('button', { text: 'Export as...' });
		const greetingContainer = this.container.createDiv();
		const headingDiv = this.container.createEl('div');
		const inputContainer = this.container.createDiv();
		const heading = this.container.createEl('h1', { text: 'Scratch-Pad' });
		const caption = this.container.createEl('p', { text: 'A Place for quick thoughts.' });
		const mdRenderedText = this.container.createDiv();
		const savedContent = (this.plugin.settings?.savedMarkdown) || '';
		this.textArea = this.container.createEl('textarea') as HTMLTextAreaElement;

		headingDiv.setCssStyles({
			'display': 'flex',
			'justifyContent': 'center',
			'margin': '0',
			'marginBottom': '5px',
		});
		caption.setCssStyles({
			'margin': '0',
			'fontSize': '18px',
			'fontWeight': 'bold',
			'textAlign': 'center',
		});
		btnContainer.setCssStyles({
			'display': 'flex',
			'justifyContent': 'space-between',  // This spreads the buttons evenly
			'gap': '10px',  // Adds spacing between buttons
			'marginTop': '10px'
		});
		// Greeting Container Style
		greetingContainer.setCssStyles({
			'display': 'flex',
			'flexDirection': 'column',
			// 'marginBottom': '50px'
		});
		// Input Container Style
		inputContainer.setCssStyles({
			'display': 'flex',
			'flexDirection': 'column',
			// 'position': 'relative',
			'width': '100%',
			'height': '95%',
			'justifyContent': 'center'
		});
		// Text Area Style
		this.textArea.setCssStyles({
			'width': '100%',
			'height': '95%',
			'padding': '10px',
			'fontFamily': 'monospace',
			'fontSize': '18px',
			'lineHeight': '1.5',
			'backgroundColor': 'rgba(50, 9, 81, 0.614)', // 'darkslategrey',
			'border': '1px solid #ccc',
			'borderRadius': '5px',
			'overflowY': 'auto',
			'display': 'none',
			'marginBottom': '10px',
			'caretColor': 'white',
		});
		this.textArea.id = 'right-text-area';
		mdRenderedText.setCssStyles({
			'width': '100%',
			'height': '95%', // 95
			'padding': '10px',
			'fontFamily': 'monospace',
			'fontSize': '18px',
			'lineHeight': '1.5',
			'backgroundColor': 'darkslateblack',
			'borderRadius': '5px',
			'border': '1px solid #ccc',
			'overflowY': 'auto',
			'marginBottom': '10px'
		});
		mdRenderedText.id = 'right-rendered-text';
		this.textArea.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Tab') {
				event.preventDefault(); // Prevent the default tab behavior (focus change)
				// Get the current cursor position in the textarea
				const start = this.textArea.selectionStart;
				const end = this.textArea.selectionEnd;
				// Set textarea value to: text before caret + tab + text after caret
				this.textArea.value = this.textArea.value.substring(0, start) + '\t' + this.textArea.value.substring(end);
				// Move the cursor after the inserted tab
				this.textArea.selectionStart = this.textArea.selectionEnd = start + 1;
			}
			// Handle the Meta + L key combination
			if (event.metaKey && event.key === 'l') { // For MacOS (Cmd + L)
				event.preventDefault(); // Prevent default behavior if needed (e.g., jumping to URL)
				this.insertTaskAtLine();
				setTimeout(() => {}, 2000);
			}

			// Optionally, handle Ctrl + L for non-MacOS systems (Ctrl + L)
			if (event.ctrlKey && event.key === 'l') { // For Windows/Linux (Ctrl + L)
				event.preventDefault(); // Prevent default behavior if needed
				// Add your custom action for Ctrl + L here
				this.insertTaskAtLine();
			}
		});
		// Create a debounced keyup handler and store the reference
		this.debouncedKeyUpHandler = this.debounce(async (event: KeyboardEvent) => {
			const element = event.target as HTMLTextAreaElement;
			const value = element.value;
			mdRenderedText.innerHTML = await renderMarkdown(value, this.plugin);
			if (this.plugin.settings) {
				this.plugin.settings.savedMarkdown = value;
				await this.plugin.saveSettings();
			}
		}, 300);
		this.textArea.addEventListener('keyup', this.debouncedKeyUpHandler);
		toggleButton.addEventListener('click', () => {
			const isPreview = this.textArea.style.display === 'none';
			this.textArea.style.display = isPreview ? 'block' : 'none';
			mdRenderedText.style.display = isPreview ? 'none' : 'block';
		});
		toggleStatusBar.addEventListener('click', () => {
			const statusBar = document.querySelector('.status-bar') as HTMLElement | null;
			const statusBarIsVisible = statusBar?.style.display !== 'none';
			if (statusBar && statusBarIsVisible) statusBar.style.display = 'none';
			else if (statusBar && !statusBarIsVisible) statusBar.style.display = 'flex';
		});
		toggleVaultBar.addEventListener('click', () => {
			const vaultBar = document.querySelector('.workspace-sidedock-vault-profile') as HTMLElement | null;
			const vaultBarIsVisible = vaultBar?.style.display !== 'none';
			if (vaultBar && vaultBarIsVisible) vaultBar.style.display = 'none';
			else if (vaultBar && !vaultBarIsVisible) vaultBar.style.display = 'flex';
		});
		openInMainView.onclick = async () => {
			const types: WorkspaceLeafTypes[] = ['middle'];
			const viewTypes: ItemViewTaskTypes[] = ['my-custom-view'];
			await this.plugin.activateView(viewTypes, true, types);
		}
		copyContent.onclick = async () => {
			const content = this.plugin.settings.savedMarkdown;
			await navigator.clipboard.writeText(content);
			new Notify(this.app, this.plugin, `The following has been written to your clipboard:\n${content}`);
		}
		clearContent.onclick = async () => {
			const confirmClear = confirm('Are you sure you want to clear the current data?');
			if (confirmClear) {
				const allTextAreas = this.container.querySelectorAll('#right-text-area');
				const allMdTextAreas = this.container.querySelectorAll('#right-rendered-text');
				
				allTextAreas.forEach((area: HTMLTextAreaElement) => {
					area.value = '';
				});
				allMdTextAreas.forEach((area: HTMLDivElement) => {
					area.innerHTML = '';
				});
				await this.updateContent('');
			}
		}
		saveScratchPadContent.onclick = () => {
			const content =  this.plugin.settings.savedMarkdown;
			new SaveMdFileModal(this.app, this.plugin, content).open();
		}
		this.eventListeners.push(
			{ element: this.textArea, handler: this.debouncedKeyUpHandler, listenerType: 'keyup' },
			{
				element: this.textArea,
				handler: (event: KeyboardEvent) => {
					if (event.key === 'Tab') {
						event.preventDefault(); // Prevent the default tab behavior (focus change)
						// Get the current cursor position in the textarea
						const start = this.textArea.selectionStart;
						const end = this.textArea.selectionEnd;
						// Set textarea value to: text before caret + tab + text after caret
						this.textArea.value = this.textArea.value.substring(0, start) + '\t' + this.textArea.value.substring(end);
						// Move the cursor after the inserted tab
						this.textArea.selectionStart = this.textArea.selectionEnd = start + 1;
					}
					// Handle the Meta + L key combination
					if (event.metaKey && event.key === 'l') { // For MacOS (Cmd + L)
						event.preventDefault(); // Prevent default behavior if needed (e.g., jumping to URL)
						this.insertTaskAtLine();
						setTimeout(() => {}, 2000);
					}

					// Optionally, handle Ctrl + L for non-MacOS systems (Ctrl + L)
					if (event.ctrlKey && event.key === 'l') { // For Windows/Linux (Ctrl + L)
						event.preventDefault(); // Prevent default behavior if needed
						// Add your custom action for Ctrl + L here
						this.insertTaskAtLine();
					}
				},
				listenerType: 'keydown'
			},
			{
				element: toggleButton,
				handler: () => {
					const isPreview = this.textArea.style.display === 'none';
					this.textArea.style.display = isPreview ? 'block' : 'none';
					mdRenderedText.style.display = isPreview ? 'none' : 'block';
				},
				listenerType: 'click'
			},
			{
				element: toggleStatusBar,
				handler: () => {
					const statusBar = document.querySelector('.status-bar') as HTMLElement | null;
					const statusBarIsVisible = statusBar?.style.display !== 'none';
					if (statusBar && statusBarIsVisible) statusBar.style.display = 'none';
					else if (statusBar && !statusBarIsVisible) statusBar.style.display = 'flex';
				},
				listenerType: 'click'
			},
			{
				element: toggleVaultBar,
				handler: () => {
					const vaultBar = document.querySelector('.workspace-sidedock-vault-profile') as HTMLElement | null;
					const vaultBarIsVisible = vaultBar?.style.display !== 'none';
					if (vaultBar && vaultBarIsVisible) vaultBar.style.display = 'none';
					else if (vaultBar && !vaultBarIsVisible) vaultBar.style.display = 'flex';
				},
				listenerType: 'click'
			},
		)

		this.textArea.setText(savedContent);
		mdRenderedText.innerHTML = await renderMarkdown(savedContent, this.plugin);
		headingDiv.appendChild(heading);
		greetingContainer.append(headingDiv, caption);
		btnContainer.append(toggleButton, toggleStatusBar, toggleVaultBar, openInMainView, copyContent, clearContent, saveScratchPadContent, exportScratchPadContent);
		if (this.plugin.isMobile()) {
			console.log(`IS-MOBILE....`);
			const mobileBtnContainer = this.container.createDiv();
			mobileBtnContainer.setCssStyles({
				'display': 'flex',
				'overflow': 'auto'
			});
			mobileBtnContainer.appendChild(btnContainer);
			inputContainer.append(mobileBtnContainer, mdRenderedText, this.textArea);
		} else {
			inputContainer.append(btnContainer, mdRenderedText, this.textArea);
		}
		this.deformatPanes();
		this.handleCopyBtns();
	}

	async onClose() {
		// Remove the event listener when closing the view
		this.eventListeners.forEach(({ element, handler, listenerType }) => {
			element.removeEventListener(listenerType, handler);
		});
		this.container.empty();
	}

	handleCopyBtns() {
		const copyButtons = document.querySelectorAll("#btn-custom-copy");
		if (copyButtons && copyButtons?.length) {
			copyButtons.forEach((btn) => {
				const copyBtn = btn as HTMLElement;
				const codeParent = copyBtn.parentElement as HTMLPreElement;
				const codeText = codeParent.querySelector('.custom-loaded')?.textContent ?? '';
				copyBtn.onclick = async () => {
					try {
						await navigator.clipboard.writeText(codeText);
						btn.textContent = 'Copied!';
						setTimeout(() => {
							btn.textContent = 'Copy';
						}, 1500);
					} catch (err) {
						console.error('Failed to copy text: ', err);
						btn.textContent = 'Failed to copy';
						setTimeout(() => {
							btn.textContent = 'Copy';
						}, 1500);
					}
				};
			});
		}
	}

	async updateContent(content: string) {
		const mainWorkspaceTab = document.querySelector('.mod-vertical');
		const mdRenderedTextMid = mainWorkspaceTab?.querySelector('div[id="right-rendered-text"]') as HTMLElement;
		const textAreaMid = mainWorkspaceTab?.querySelector('textarea[id="right-text-area"]') as HTMLElement;
		if (mdRenderedTextMid) mdRenderedTextMid.innerHTML = await renderMarkdown(content, this.plugin);
		if (textAreaMid) textAreaMid.setText(content);
		this.handleCopyBtns();
		this.plugin.settings.savedMarkdown = content;
		await this.plugin.saveSettings();
	}

	async updateCheckboxState(checkbox: HTMLInputElement): Promise<void> {
		const key = checkbox.dataset.key;

		if (key && this.plugin.settings) {
			this.plugin.settings.checkboxState[key] = checkbox.checked;
			await this.plugin.saveSettings();
			const allCheckBoxes: NodeListOf<HTMLInputElement> | null = document
				.querySelectorAll(`[data-key="${key}"]`);

			for (const cb of Array.from(allCheckBoxes)) {
				// Find the span element that contains the text
				const textElement = cb.nextElementSibling as HTMLElement;
				if (textElement && textElement.classList.contains('checkbox-text')) {
					// Update the text with or without strikethrough based on the checkbox state
					if (checkbox.checked) {
						cb.checked = true;
						textElement.innerHTML = `<s>${textElement.innerHTML}</s>`;
					} else {
						cb.checked = false;
						const strikeElement = textElement.querySelector('s');
						if (strikeElement) textElement.innerHTML = textElement.removeChild(strikeElement).innerHTML;
					}
				}
			}
		}
	}

	deformatPanes() {
		const mainWorkspaceTab = document.querySelector('.mod-vertical');
		const mdRenderedTextMid = mainWorkspaceTab?.querySelector('div[id="right-rendered-text"]') as HTMLElement;
		const greetingContainerMid = mainWorkspaceTab?.querySelector('.workspace-leaf-content[data-type="my-custom-view"]>div:has(h1)');
		const btnsMid = mainWorkspaceTab?.querySelectorAll('.workspace-leaf-content[data-type="my-custom-view"]>div:has(button) button');
		const textAreaMid = mainWorkspaceTab?.querySelector('textarea[id="right-text-area"]') as HTMLElement;
		if (greetingContainerMid) greetingContainerMid.remove();
		if (btnsMid) for (const btn of Array.from(btnsMid)) btn.remove();
		if (mdRenderedTextMid) mdRenderedTextMid.style.border = 'none';
		if (textAreaMid) textAreaMid.style.display = 'none';
	}

	debounce(func: Function, wait: number) {
		let timeout: number;
		return (...args: any) => {
			clearTimeout(timeout);
			timeout = window.setTimeout(async () => {
				await func.apply(this, args);
				await this.updateContent(this.plugin.settings.savedMarkdown);
			}, wait);
		};
	}

	// Function to insert '- [ ] ' at the beginning of the current line
	insertTaskAtLine() {
		// Get the current cursor position
		const start = this.textArea.selectionStart;
		const end = this.textArea.selectionEnd;

		// Get the current line based on the cursor position
		const lines = this.textArea.value.split('\n');
		let currentLine = '';
		let lineStartIndex = 0;
		let cursorLineIndex = 0;

		// Find the current line and its start index
		for (let i = 0; i < lines.length; i++) {
			lineStartIndex += lines[i].length + 1; // Account for the newline character
			if (lineStartIndex > start) {
				currentLine = lines[i];
				cursorLineIndex = i;
				break;
			}
		}

		if (currentLine.trim().match(/^- \[.\]/g)) return; // avoid spamming
		// Insert '- [ ] ' at the beginning of the current line
		const newLineContent = `- [ ] ${currentLine.trim()}`;
		lines[cursorLineIndex] = newLineContent;

		// Update the textarea value with the modified content
		this.textArea.value = lines.join('\n');

		// Move the cursor to the end of the newly inserted line
		const newCaretPosition = lineStartIndex + 6; // Position after '- [ ] '
		this.textArea.selectionStart = this.textArea.selectionEnd = newCaretPosition;
	}

	  onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string) {
		if (source == "more-options" || source == "tab-header") {
			super.onPaneMenu(menu, source);
			menu.addItem((item) => {
				item
				.setTitle('Custom View')
				.setIcon("power")
				.onClick(() => {
					const existingLeaves = this.app.workspace.getLeavesOfType('my-custom-view');
					if (existingLeaves[0]) {
						this.app.workspace.moveLeafToPopout(existingLeaves[0]);
					}
				})
				.setSection("open");
			});
			return;
		}
		// In other cases, keep the original
		super.onPaneMenu(menu, source);
	}
}

export class SaveMdFileModal extends Modal {
	app: App;
	plugin: ProjectsHTMLInjector;
	fileContent: string;
	folderPaths: string[];
	currentOptionIndex: number;
	currentOption: HTMLElement | null;

	constructor(app: App, plugin: ProjectsHTMLInjector, fileContent: string) {
		super(app);
		this.app = app;
		this.plugin = plugin;
		this.fileContent = fileContent;
		this.folderPaths = [];
		this.currentOptionIndex = -1;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		this.folderPaths = await this.getFolderPaths()
		const mainContainer = contentEl.createEl('div');
		const header = contentEl.createEl('h1', { text: 'Save as Obsidian File' });
		const inputArea = contentEl.createEl('input', { type: 'text', placeholder: 'filepath here...' });
		// Create a dropdown for folder path suggestions
		const suggestionContainer = contentEl.createEl('ul', { cls: 'folder-suggestions' });
		const btnContainer = contentEl.createEl('div');
		const saveBtn = btnContainer.createEl('button', { text: 'Save' });
		const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' });

		inputArea.setCssStyles({
			'width': '100%'
		})
		suggestionContainer.setCssStyles({
			'display': 'none', // Hide initially
			'position': 'relative',
			'width': '100%',
			'height': 'fit-content',
			'overflowY': 'auto',
			'backgroundColor': 'black',
			'border': '1px solid #ccc',
			'zIndex': '1000',
			'listStyle': 'none',
			'padding': '0',
			'marginTop': '5px',
		});

		btnContainer.setCssStyles({
			'display': 'flex',
			'justifyContent': 'center',
			'marginTop': '10px'
		});

		// Event listener to handle typing in the input and show suggestions
		inputArea.addEventListener('input', () => {
			const inputValue = inputArea.value;
			this.populateSuggestions(inputValue, suggestionContainer);
		});
		contentEl.addEventListener('click', (event: FocusEvent) => {
			const inputValue = inputArea.value;
			const nodeName = event.targetNode?.nodeName;
			if (nodeName !== 'LI' && nodeName !== 'INPUT') {
				suggestionContainer.style.display = 'none';
				this.currentOptionIndex = -1;
				this.currentOption = null;
			} else if (nodeName === 'INPUT') {
				this.populateSuggestions('', suggestionContainer);
				this.currentOptionIndex = this.currentOptionIndex === -1 ? 0 : this.currentOptionIndex;
				this.currentOption = suggestionContainer.children.item(this.currentOptionIndex) as HTMLElement | null;
				this.handleOptions(suggestionContainer, 'down');
			}
		});
		inputArea.addEventListener('keydown', (event) => {
			const key = event.key;
			const inputValue = inputArea.value;
			if (key === 'ArrowDown') {
				event.preventDefault();
				if (suggestionContainer.style.display === 'none') this.populateSuggestions(inputValue, suggestionContainer);
				// Ensure the index is updated correctly and doesn't exceed the length
				if (this.currentOptionIndex <= suggestionContainer.children.length - 1) {
					if (this.currentOptionIndex === suggestionContainer.children.length - 1) this.currentOptionIndex = 0;
					else this.currentOptionIndex += 1;
				} else if (this.currentOptionIndex > suggestionContainer.children.length - 1 || this.currentOptionIndex === -1) {
					this.currentOptionIndex = 0;
				}
				//console.log(this.currentOptionIndex);
				this.handleOptions(suggestionContainer, 'up'); // 'up', meaning directional in relation to list position in order to head to find last option
			}
			// Handle ArrowUp if you want to move back through the list
			if (key === 'ArrowUp') {
				event.preventDefault();
				if (suggestionContainer.style.display === 'none') this.populateSuggestions(inputValue, suggestionContainer);
				// Ensure the index is updated correctly and doesn't go below 0
				if (this.currentOptionIndex > 0 && this.currentOptionIndex <= suggestionContainer.children.length - 1) {
					this.currentOptionIndex -= 1;
				} else if (this.currentOptionIndex > suggestionContainer.children.length - 1 || this.currentOptionIndex === -1) {
					this.currentOptionIndex = 0;
				} else if (this.currentOptionIndex === 0) {
					this.currentOptionIndex = suggestionContainer.children.length - 1;
				}
				this.handleOptions(suggestionContainer, 'down'); // 'down', meaning directional in relation to list position in order to head to find last option
			}

			if (key === 'Return' || key === 'Enter') {
				event.preventDefault();
				if (this.currentOption && this.currentOption?.textContent && inputArea && suggestionContainer.style.display !== 'none') {
					inputArea.value = this.currentOption.textContent ?? '';
					suggestionContainer.style.display = 'none'; // 
				}
			}
		});
		// Event listener to handle clicking a suggestion
		suggestionContainer.addEventListener('click', (event: MouseEvent) => {
			const target = event.target as HTMLLIElement;
			console.log(event.targetNode?.nodeName)
			if (target.tagName === 'LI') {
				inputArea.value = target.textContent || ''; // Set the input value to the clicked suggestion
				inputArea.focus();
				//suggestionContainer.style.display = 'none'; // Hide the suggestion list
			}
		});
		saveBtn.onclick = async () => {
			const filePath = inputArea.value;
			await this.app.vault.create(filePath, this.fileContent);
			if (await this.app.vault.adapter.exists(filePath)) {
				new Notify(this.app, this.plugin, `✅ ${filePath} has been saved!`);
				await this.app.workspace.openLinkText(filePath, filePath, true);
			} else {
				new Notice(`Error saving ${filePath}...\nCheck the developer console.for more details.`);
			}
			this.close();
		}
		cancelBtn.onclick = () => {
			this.close();
		}
	}

	handleOptions(suggestionContainer: HTMLElement, direction: 'down' | 'up') {
		// Get the current option and the last option
		this.currentOption = suggestionContainer.children.item(this.currentOptionIndex) as HTMLElement | null;
		if (!this.currentOption) this.currentOption = suggestionContainer.children.item(0) as HTMLElement;
		let lastOption;
		
		if (direction === 'up') { // ARROW DOWN - MUST SUBTRACT TO CALCULATE LAST OPTION
			lastOption = this.currentOptionIndex < 1 ? suggestionContainer.children.item(suggestionContainer.children.length - 1) : suggestionContainer.children.item(this.currentOptionIndex - 1); // last option was lower (higher up) in the list, therefore lower value
		} else { // ARROW UP - MUST ADD TO CALCULATE LAST OPTION
			lastOption = this.currentOptionIndex === suggestionContainer.children.length - 1 ? suggestionContainer.children.item(0) : suggestionContainer.children.item(this.currentOptionIndex + 1); // Last option was higher (lower down) in list, there
		}
		
		// Remove styles from the last option
		if (lastOption && lastOption instanceof HTMLElement) {
			lastOption.removeAttribute('id');
			lastOption.style.backgroundColor = 'black'; // Reset to default styles
			lastOption.style.color = 'white'; // Reset to default styles
		}

		// Apply styles to the current option
		if (this.currentOption && this.currentOption instanceof HTMLElement) {
			this.currentOption.setAttribute('id', 'current-option'); // Set an ID for easy access
			this.currentOption.style.backgroundColor = 'white'; // Highlight the current option
			this.currentOption.style.color = 'black'; // Change the text color
			
			// Scroll the current option into view if it's out of the container's visible area
			this.currentOption.scrollIntoView({
				behavior: 'instant', // Smooth scrolling animation
				block: 'center',   // Scrolls only if the item is not already fully visible
				inline: 'center'   // Keeps horizontal scrolling intact
			});
		}
		return lastOption;
	}

	// Fetch all folder paths in the vault
	async getFolderPaths(): Promise<string[]> {
		const files = this.app.vault.getAllFolders();
		const folderPaths: string[] = [];
		for (const file of files) {
			if (file instanceof TFolder) {
				folderPaths.push(file.path);
			}
		}
		return folderPaths;
	}

	// Populate the dropdown with folder suggestions based on user input
	populateSuggestions(inputValue: string, suggestionContainer: HTMLUListElement): void {
		// Clear the previous suggestions
		suggestionContainer.innerHTML = '';

		// Filter folder paths based on the input value
		const matchingFolders = this.folderPaths.filter((folder) => folder.toLowerCase().includes(inputValue.toLowerCase())).sort();

		if (matchingFolders.length > 0) {
			// Populate the suggestion list with matching folders
			matchingFolders.forEach((folder) => {
				const suggestionItem = document.createElement('li');
				suggestionItem.textContent = folder;
				suggestionItem.id = 'suggestion-item';
				suggestionItem.setCssStyles({
					'padding': '5px',
					'cursor': 'pointer',
					'borderBottom': '1px solid #ccc'
				});
				suggestionContainer.appendChild(suggestionItem);
			});
			suggestionContainer.style.display = 'block'; // Show the suggestion list
		} else {
			suggestionContainer.style.display = 'none'; // Hide if no matches
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}


export class Notify extends Notice {
	app: App;
	plugin: ProjectsHTMLInjector;
	message: string | DocumentFragment;
	duration: number;
	noticeEl: HTMLElement;
	renderFunction: Function;

	constructor(app: App, plugin: ProjectsHTMLInjector, message: string | DocumentFragment, duration?: number, renderFunction?: Function) {
		super(message, duration ?? 0);
		this.renderFunction = renderFunction ?? ScratchPadView;
		this.app = app;
		this.plugin = plugin;
		this.message = message;
		this.noticeEl = this.setMessage('<span>hello</span> ' + this.message).noticeEl;
		this.noticeEl.setCssStyles({
			'maxWidth': '100%',
			'width': '100%',
			'maxHeight': '100%',
			'position': 'fixed',
			'left': '0px',
			'right': 'auto',
			'top': '0px',
			// 'textAlign': 'left',
			'fontSize': 'xx-large',
			'border': 'dotted',
			'borderColor': 'maroon',
			'overflow': 'auto'
		});
		this.noticeEl.onclick = () => {
			this.hide();
		}
		this.duration = duration ?? 0;
	}

	setMessage(message: string | DocumentFragment): this {
		this.message = message;
		return this;
	}
}

export class TaskView extends ItemView {
	app: App;
	plugin: ProjectsHTMLInjector;
	container: HTMLElement;
	header: HTMLElement;
	taskHeader: HTMLElement | null;
	taskCreator: typeof TaskModal | undefined;
	taskViewer: typeof TaskViewer | undefined;
	taskData: TaskTracker | undefined;
	currentTaskName: string | null;
	currentTaskTime: string | null;
	currentTaskDesc: string | null;
	currentTaskId: string | null;
	tasksOverdueCount: number | null;
	upcomingTasks: UpcomingTask[];
	lateTasks: LateTask[];
	taskObj: Task;
	taskDiv: HTMLDivElement;
	mainTaskContainer: HTMLDivElement;
	taskHeadData: HTMLDivElement;
	pageTitle: HTMLElement;
	undoCompletedTask: HTMLButtonElement;
	lastCompletedTask: string | null;
	overdueTaskDiv: HTMLElement;
	containerEncapsulatorOne: HTMLElement;
	containerEncapsulatorTwo: HTMLElement;
	leaf: WorkspaceLeaf;
	isSideBar: boolean;
	viewType: ItemViewTaskTypes;
	taskReloader: () => Promise<void>;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectsHTMLInjector, header: HTMLElement, viewType: ItemViewTaskTypes) {
		super(leaf);
		this.leaf = leaf;
		this.isSideBar = (leaf.parent as any)?.parentSplit?.direction === 'horizontal';
		this.viewType = viewType;
		this.plugin = plugin;
		this.header = header;
		this.taskCreator = this.plugin.taskCreator;
		this.taskViewer = this.plugin.taskViewer;
		this.taskData = this.plugin.todoistInitializor; // Used to access task class attributes/definitions
		this.currentTaskName = null;
		this.currentTaskTime = null;
		this.currentTaskId = null;
		this.tasksOverdueCount = null;
		this.lastCompletedTask = null;
		this.taskObj = {
			id: '',
			order: 0,
			content: '',
			description: '',
			projectId: '',
			isCompleted: false,
			labels: [],
			priority: 4,
			commentCount: 0,
			createdAt: '',
			url: '',
			creatorId: '',
			due: {
				string: '',
				isRecurring: false,
				date: '',
					datetime: '',
					timezone: '',
					lang: '',
			},
			duration: {
				amount: 30,
				unit: 'minute',
			},
			assigneeId: null,
			assignerId: null,
			parentId: null,
			sectionId: null,
		};
		this.upcomingTasks = [];
		this.lateTasks = [];
		this.taskReloader = this.reloadAll;
	}

	getViewType(): string {
		return this.viewType;
	}

	getDisplayText(): string {
		return 'Task View';
	}

	getIcon(): IconName {
		return 'clipboard-check';
	}

	async onOpen(): Promise<void> {
		//await this.plugin.initializationPromise;
		await this.plugin.todoistInitializor?.apiGrabber();
		this.taskData = this.plugin.todoistInitializor;

		this.currentTaskName = this.taskData?.closestTaskName ?? 'NONE';
		this.currentTaskDesc = this.taskData?.closestTaskDesc ?? 'NONE';
		this.currentTaskTime = this.taskData?.closestTaskTime ?? 'NONE';
		this.currentTaskId = this.taskData?.closestTaskId ?? '';
		this.tasksOverdueCount = this.taskData?.overDueCount ?? 0;
		this.upcomingTasks = this.taskData?.upcomingTasks ?? this.upcomingTasks;
		this.lateTasks = this.taskData?.lateTasks ?? this.lateTasks;
		const relativeTaskTime = this.plugin.todoistInitializor?.getRelativeTimeString(this.currentTaskTime)
			.replace(/ hours?/, 'h')
			.replace(/ minutes?/, 'm')
			.replace(/ seconds?/, 's')
			.trim();

		this.container = this.containerEl as HTMLElement;
		this.container.empty();
		this.container.setAttr('data-type', 'task-view');

		if (this.header && !this.isSideBar) this.container.appendChild(this.header);

		this.taskHeadData = this.container.createEl('div');

		this.pageTitle = this.container.createEl('li');
		this.pageTitle.classList.add('taskview-title');
		this.pageTitle.textContent = '📋 Task View';

		const taskButtonPanel = document.createElement('div');
		taskButtonPanel.setCssStyles({
			'display': 'flex',
			'justifyContent': 'center',
			'gap': '3px'
		});

		const createTaskBtn = document.createElement('button');
		createTaskBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="25" width="36" viewBox="0 0 576 512">
			<path d="M243.1 2.7c11.8 6.1 16.3 20.6 10.2 32.4L171.7 192l232.6 0L322.7 35.1c-6.1-11.8-1.5-26.3 10.2-32.4s26.2-1.5\
			32.4 10.2L458.4 192l36.1 0 49.5 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-20 0L476.1 463.5C469 492 443.4 512 414\
			512L162 512c-29.4 0-55-20-62.1-48.5L44 240l-20 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l8 0 49.5 0 36.1 0L210.7 12.9c6.1-11.8\
			20.6-16.3 32.4-10.2zM482.5 240l-389 0 53 211.9c1.8 7.1 8.2 12.1 15.5 12.1L414 464c7.3 0 13.7-5 15.5-12.1l53-211.9zM200\
			352c0-13.3 10.7-24 24-24l40 0 0-40c0-13.3 10.7-24 24-24s24 10.7 24 24l0 40 40 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-40 0 0\
			40c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-40-40 0c-13.3 0-24-10.7-24-24z"/>
		</svg>`;
		createTaskBtn.ariaLabel = 'Create a new task.';
		createTaskBtn.setCssStyles({
			'width': '50px',
			'fontSize': 'x-large',
			'color': '#127ee6',
		});

		const refreshTasks = document.createElement('button');
		refreshTasks.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="25" width="32" viewBox="0 0 576 512">
			<path 
				d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160 352 160c-17.7 0-32 14.3-32\
				32s14.3 32 32 32l111.5 0c0 0 0 0 0 0l.4 0c17.7 0 32-14.3 32-32l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 35.2L414.4\
				97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39\
				289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1L16 432c0 17.7 14.3 32 32\
				32s32-14.3 32-32l0-35.1 17.6 17.5c0 0 0 0 0 0c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9\
				2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-.1-.1L125.6 352l34.4 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L48.4\
				288c-1.6 0-3.2 .1-4.8 .3s-3.1 .5-4.6 1z"
			/>
		</svg>`;
		refreshTasks.ariaLabel = 'Refresh the task list.';
		refreshTasks.setCssStyles({
			'width': '50px',
			'fontSize': 'x-large',
			'color': '#127ee6',
		});

		this.undoCompletedTask = document.createElement('button');
		this.undoCompletedTask.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="25" width="32" viewBox="0 0 576 512">
			<path
				d="M48 106.7L48 56c0-13.3-10.7-24-24-24S0 42.7 0 56L0 168c0 13.3 10.7 24 24 24l112 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-55.3\
				0c37-57.8 101.7-96 175.3-96c114.9 0 208 93.1 208 208s-93.1 208-208 208c-42.5 0-81.9-12.7-114.7-34.5c-11-7.3-25.9-4.3-33.3 6.7s-4.3\
				25.9 6.7 33.3C155.2 496.4 203.8 512 256 512c141.4 0 256-114.6 256-256S397.4 0 256 0C170.3 0 94.4 42.1 48 106.7zM256 128c-13.3 0-24\
				10.7-24 24l0 104c0 6.4 2.5 12.5 7 17l72 72c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-65-65 0-94.1c0-13.3-10.7-24-24-24z"
			/>
		</svg>`;
		this.undoCompletedTask.ariaLabel = 'Undo your most previous task completion.'
		this.undoCompletedTask.setCssStyles({
			'width': '50px',
			'fontSize': 'x-large',
			'color': '#127ee6'
		});
		this.undoCompletedTask.disabled = !this.lastCompletedTask;

		const hideHeaderDisplay = document.createElement('button');
		hideHeaderDisplay.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="32" width="40" viewBox="0 0 640 512">
			<path
				d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6\
				386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320\
				32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1zM223.1 149.5C248.6 126.2 282.7 112 320 112c79.5 0 144 64.5 144 144c0 24.9-6.3\
				48.3-17.4 68.7L408 294.5c8.4-19.3 10.6-41.4 4.8-63.3c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4\
				3.3 13.2 3.3 20.3c0 10.2-2.4 19.8-6.6 28.3l-90.3-70.8zM373 389.9c-16.4 6.5-34.3 10.1-53 10.1c-79.5 0-144-64.5-144-144c0-6.9\
				.5-13.6 1.4-20.2L83.1 161.5C60.3 191.2 44 220.8 34.5 243.7c-3.3 7.9-3.3 16.7 0 24.6c14.9 35.7 46.2 87.7 93 131.1C174.5 443.2\
				239.2 480 320 480c47.8 0 89.9-12.9 126.2-32.5L373 389.9z"
			/>
		</svg>`;
		hideHeaderDisplay.ariaLabel = 'Hide the page title.';
		hideHeaderDisplay.id = 'hide-header-btn';
		hideHeaderDisplay.setCssStyles({
			'width': '50px',
			'fontSize': 'x-large',
			'color': '#127ee6',
		});

		this.mainTaskContainer = this.container.createEl('div');
		this.containerEncapsulatorOne = this.container.createEl('div');
		this.containerEncapsulatorTwo = this.container.createEl('div');
		const isMobile = this.plugin.isMobile();
		this.mainTaskContainer.setCssStyles({
			'display': 'flex',
			'justifyContent': 'center',
			'gap': '10px',
			'width': '100%',
			'overflow': 'auto'
		});
		if (isMobile || this.isSideBar) {
			this.mainTaskContainer.style.flexDirection = 'column';
			this.mainTaskContainer.style.justifyContent = 'flex-start';
		}
		this.containerEncapsulatorOne.setCssStyles({
			'display': 'flex',
			'flexDirection': 'column',
			'width': '50%'
		});
		this.containerEncapsulatorTwo.setCssStyles({
			'display': 'flex',
			'flexDirection': 'column',
			'width': '50%'
		});
		if (isMobile || this.isSideBar) {
			this.containerEncapsulatorOne.style.width = '100%';
			this.containerEncapsulatorTwo.style.width = '100%';
		}

		this.taskDiv = this.container.createEl('div');
		this.taskDiv.classList.add('home-tasks');
		this.taskDiv.id = 'taskHolder';
		this.taskDiv.setCssStyles({
			'display': 'flex',
			'flexDirection': 'column',
		});

		const activeTasksHeader = this.container.createEl('h2');
		activeTasksHeader.textContent = 'UPCOMING';

		this.overdueTaskDiv = this.container.createEl('div');
		this.overdueTaskDiv.classList.add('home-tasks');
		this.overdueTaskDiv.id = 'overdueTaskHolder';
		this.overdueTaskDiv.setCssStyles({
			'display': 'flex',
			'flexDirection': 'column'
		});
		const overDueTasksHeader = this.container.createEl('h2');
		overDueTasksHeader.textContent = 'OVERDUE';
		if (isMobile || this.isSideBar) {
			this.taskDiv.style.width = '100%';
			activeTasksHeader.style.width = '100%';
			overDueTasksHeader.style.width = '100%';
		}

		const nextOverdueTasksDiv = this.container.createEl('div');
		nextOverdueTasksDiv.setCssStyles({
			'display': 'flex',
			'alignItems': 'center'
		});

		const nextTaskDiv = this.container.createEl('div');
		nextTaskDiv.id = this.currentTaskId;
		if (isMobile || this.isSideBar) nextTaskDiv.style.width = '100%';
		nextTaskDiv.ariaLabel = this.currentTaskDesc === '' ? '...' : this.currentTaskDesc;
		nextTaskDiv.setCssStyles({
			'marginLeft': '10px',
			'display': 'flex',
			'alignItems': 'center',
			'flex': '0 1 75px',
		});
		nextTaskDiv.onmouseenter = () => {
			nextTaskDiv.style.background = 'darkslategray';
		}
		nextTaskDiv.onmouseleave = () => {
			nextTaskDiv.style.background = 'none'
		}

		const taskDataCheckbox = this.container.createEl('input');
		taskDataCheckbox.type = 'checkbox';
		taskDataCheckbox.style.flex = '0 0 auto'

		const taskNameIsLink = this.currentTaskName.match(/(?<=\[)[\s\S]+?(?=\]\([\s\S]+?\))/g);
        const linkUrlMatch = this.currentTaskName.match(/(?<=\[[\s\S]+\]\()[\s\S]+?(?=\))/g);

		let taskDataName: HTMLElement;
        if (taskNameIsLink && linkUrlMatch) {
            // If the task name is a link, create a clickable heading
            taskDataName = this.container.createEl('span');
            const anchor = taskDataName.createEl('a', { href: linkUrlMatch[0], text: taskNameIsLink[0] });
            anchor.setAttrs({
                'target': '_blank', // Opens the link in a new tab
				'class': 'internal-link'
        	});
			anchor.onmouseenter = async () => {
				anchor.style.cursor = 'pointer';
			}
			anchor.onmouseleave = async () => {
				anchor.style.cursor = 'none';
			}
        } else {
            // If it's not a link, create a regular heading
            taskDataName = this.container.createEl('span', { text: this.currentTaskName });
        }
		taskDataName.setCssStyles({
			'display': 'flex',
			'fontWeight': 'bolder',
			'color': 'red',
			'marginLeft': '10px',
			'marginRight': '10px',
			'textAlign': 'justify',
			'fontSize': '1.5vw',
			'flex': '1 1',
			'justifyContent': 'flex-start',
			'whiteSpace': 'nowrap',
			'overflowY': 'auto'
		});

		const taskDataTime = this.container.createEl('span') as HTMLSpanElement;
		taskDataTime.classList.add('home-settings-body-value');
		taskDataTime.textContent = relativeTaskTime ?? null;
		taskDataTime.setCssStyles({ 'marginLeft': '10px' });

		const taskBtnDiv = this.container.createEl('div');
		taskBtnDiv.setCssStyles({
			'display': 'flex',
			'flex': '0 0 auto'
		})

		const taskDataViewBtn = this.container.createEl('button');
		taskDataViewBtn.textContent = 'View';
		taskDataViewBtn.setCssStyles({ 'marginLeft': '10px' });

		const taskDataDeleteBtn = this.container.createEl('button');
		taskDataDeleteBtn.textContent = 'Delete';

		createTaskBtn.onclick = () => {
			if (this.taskCreator) new this.taskCreator(this.app, this.plugin).open();
		}
		refreshTasks.onclick = async () => {
			this.taskDiv.innerHTML = '';
			this.overdueTaskDiv.innerHTML = '';
			await this.reloadAll();
			new Notice('Tasks refreshed...');
		}
		this.undoCompletedTask.onclick = async () => {
			const lastCompletedTask = this.lastCompletedTask;
			if (lastCompletedTask) {
				const todoistApi = this.plugin.todoistApi ?? new TodoistApi(this.plugin.todoistToken as string);
				if (todoistApi) {
					await todoistApi.reopenTask(lastCompletedTask);
					await this.reloadAll();
					this.lastCompletedTask = null;
					this.undoCompletedTask.disabled = true;
				}
			} else {
				new Notice('No task available for re-opening.', 0);
			}
		}
		hideHeaderDisplay.onclick = async () => {
			const headDisplayIsNone = this.pageTitle.style.display === 'none';
			this.pageTitle.style.display = headDisplayIsNone ? 'flex' : 'none';
		}
		taskDataCheckbox.addEventListener('change', async () => {
			const taskId = this.currentTaskId;
			const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken ?? '');
			let response;
			if (taskId && todoistApi) response = await todoistApi.closeTask(taskId);

			if (response && taskId && todoistApi) {
				new Notice(`${this.currentTaskName} IS NOW COMPLETE 🎉`, 0);
				this.lastCompletedTask = taskId;
				this.undoCompletedTask.disabled = false;
				await this.logTaskCompletions(await todoistApi.getTask(taskId));
				await this.reloadAll();
			} else {
				console.error(`Unable to obtain the details of ${this.currentTaskName}: `, response);
			}
		});

		taskDataViewBtn.onclick = async () => {
			const taskId = this.currentTaskId;
			const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken ?? '');
			let response;
			if (todoistApi && taskId) response = await todoistApi.getTask(taskId);
			else response = this.taskObj;
			if (this.taskViewer) new this.taskViewer(this.app, this.plugin, response).open();
		};

		taskDataDeleteBtn.onclick = async () => {
			if (confirm(`Are you sure you want to delete "${this.currentTaskName}"? This cannot be undone.`)) {
				const taskId = this.currentTaskId;
				const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken ?? '');
				let response;
				if (todoistApi && taskId) response = await todoistApi.deleteTask(taskId);
				else response = null;

				if (response) {
					new Notice(`Deleted "${this.currentTaskName}"`, 0);
					await this.reloadAll();
				} else {
					new Notice(`Error deleting "${this.currentTaskName}"\nCheck the developer console.`, 0);
					console.error(response);
				}
			} else {
				new Notice(`Deletion of "${this.currentTaskName}" cancelled.`, 0);
			}
		};

		this.taskHeadData.appendChild(this.pageTitle);
		this.taskHeadData.appendChild(taskButtonPanel);
		taskButtonPanel.append(createTaskBtn, refreshTasks, this.undoCompletedTask, hideHeaderDisplay);
		if (!this.isSideBar) {
			nextTaskDiv.append(taskDataCheckbox, taskDataName, taskDataTime, taskBtnDiv);
			taskBtnDiv.append(taskDataViewBtn, taskDataDeleteBtn);
			this.taskDiv.appendChild(nextTaskDiv);
		} else {
			console.log(`IS SIDE BAR....`);
			const mobileTaskBtnContainer = this.container.createEl('div');
			mobileTaskBtnContainer.setCssStyles({
				'display': 'flex',
				'flexDirection': 'column'
			});
			nextTaskDiv.append(taskDataCheckbox, taskDataName, taskDataTime);
			taskBtnDiv.append(taskDataViewBtn, taskDataDeleteBtn);
			mobileTaskBtnContainer.append(nextTaskDiv, taskBtnDiv);
			this.taskDiv.appendChild(mobileTaskBtnContainer);
		}
		this.containerEncapsulatorOne.append(activeTasksHeader, this.taskDiv);
		this.containerEncapsulatorTwo.append(overDueTasksHeader, this.overdueTaskDiv);
		//this.taskDiv.appendChild(nextTaskDiv);
		this.overdueTaskDiv.appendChild(nextOverdueTasksDiv);
		this.mainTaskContainer.append(this.containerEncapsulatorOne, this.containerEncapsulatorTwo);
		this.container.appendChild(this.taskHeadData);
		this.container.appendChild(this.mainTaskContainer);

		this.loadTheRest();
	}

	loadTheRest() {
		if (this.upcomingTasks || this.lateTasks) {
			if (this.upcomingTasks) this.upcomingTasks.forEach(taskDetails => {
				const taskName = Object.keys(taskDetails)[0];
				const taskTime = taskDetails[taskName].taskDueString;
				const taskId = taskDetails[taskName].taskId;
				const taskDesc = taskDetails[taskName].taskDesc === '' ? '...' : taskDetails[taskName].taskDesc;

				if (taskName !== this.currentTaskName && new Date() < new Date(taskTime)) {
					const newNextTaskDiv = document.createElement('div');
					newNextTaskDiv.id = taskId;
					newNextTaskDiv.ariaLabel = taskDesc;
					newNextTaskDiv.setCssStyles({
						'marginLeft': '10px',
						'display': 'flex',
						'flex': '0 1 75px',
						'alignItems': 'center'
					});
					newNextTaskDiv.onmouseenter = () => {
						newNextTaskDiv.style.background = 'darkslategray';
					}
					newNextTaskDiv.onmouseleave = () => {
						newNextTaskDiv.style.background = 'none';
					}

					const newTaskDataCheckbox = document.createElement('input');
					newTaskDataCheckbox.type = 'checkbox';
					
					const taskNameIsLink = taskName.match(/(?<=\[)[\s\S]+?(?=\]\([\s\S]+?\))/g);
					const linkUrlMatch = taskName.match(/(?<=\[[\s\S]+\]\()[\s\S]+?(?=\))/g);

					let newTaskDataSpan: HTMLElement;
					if (taskNameIsLink && linkUrlMatch) {
						// If the task name is a link, create a clickable heading
						newTaskDataSpan = this.container.createEl('span');
						const anchor = newTaskDataSpan.createEl('a', { href: linkUrlMatch[0], text: taskNameIsLink[0] });
						anchor.setAttrs({
							'target': '_blank',
							'class': 'internal-link'
						}); // Opens the link in a new tab
						anchor.onmouseenter = async () => {
							anchor.style.cursor = 'pointer';
						}
						anchor.onmouseleave = async () => {
							anchor.style.cursor = 'none';
						}
					} else {
						// If it's not a link, create a regular heading
						newTaskDataSpan = this.container.createEl('span', { text: taskName });
					}
					newTaskDataSpan.setCssStyles({
						'display': 'flex',
						'fontWeight': 'bolder',
						'marginLeft': '10px',
						'marginRight': '10px',
						'textAlign': 'justify',
						'fontSize': '1.5vw',
						'flex': '1 1',
						'justifyContent': 'flex-start',
						'whiteSpace': 'nowrap',
						'overflowY': 'auto'
					});

					const newTaskDataTimeSpan = document.createElement('span');
					newTaskDataTimeSpan.classList.add('home-settings-body-value');
					newTaskDataTimeSpan.textContent = this.plugin.todoistInitializor?.getRelativeTimeString(taskTime)
						.replace(/ hours?/, 'h')
						.replace(/ minutes?/, 'm')
						.replace(/ seconds?/, 's')
						.trim() ?? '';
					newTaskDataTimeSpan.setCssStyles({ 'marginLeft': '10px' });

					const newTaskDataViewBtn = document.createElement('button');
					newTaskDataViewBtn.textContent = 'View';
					newTaskDataViewBtn.setCssStyles({ 'marginLeft': '10px' });

					const newTaskDataDeleteBtn = document.createElement('button');
					newTaskDataDeleteBtn.textContent = 'Delete';

					newTaskDataCheckbox.addEventListener('change', async () => {
						const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken ?? '');
						let response;
						if (todoistApi) response = await todoistApi.closeTask(taskId);
						if (response && todoistApi) {
							new Notice(`${taskName} IS NOW COMPLETE 🎉`, 0);
							this.lastCompletedTask = taskId;
							this.undoCompletedTask.disabled = false;
							await this.logTaskCompletions(await todoistApi.getTask(taskId));
							await this.reloadAll();
						} else {
							console.error(`Unable to obtain the details of ${taskName}: `, response);
						}
					});

					newTaskDataViewBtn.onclick = async () => {
						const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken as string);
						let response;
						if (todoistApi && taskId) response = await todoistApi.getTask(taskId);
						else response = this.taskObj;
						if (this.taskViewer) new this.taskViewer(this.app, this.plugin, response).open();
					};

					newTaskDataDeleteBtn.onclick = async () => {
						if (confirm(`Are you sure you want to delete "${taskName}"? This cannot be undone.`)) {
							const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken ?? '');
							let response;
							if (todoistApi) response = await todoistApi.deleteTask(taskId);
							if (response) {
								new Notice(`Deleted "${taskName}"`, 0);
								await this.reloadAll();
							} else {
								new Notice(`Error deleting "${taskName}"\nCheck the developer console.`, 0);
								console.error(response);
							}
						}
					};

					newNextTaskDiv.append(newTaskDataCheckbox, newTaskDataSpan, newTaskDataTimeSpan, newTaskDataViewBtn, newTaskDataDeleteBtn);
					this.taskDiv.appendChild(newNextTaskDiv);
				}
			});
		}
		if (this.lateTasks) this.lateTasks.forEach(taskDetails => {
			const taskName = Object.keys(taskDetails)[0];
			const taskDesc = taskDetails[taskName].taskDesc === '' ? '...' : taskDetails[taskName].taskDesc;
			const taskNameIsLink = taskName.match(/(?<=^\[).+(?=\]\(.+?\))/g);

			let displayTaskName = taskName;
			if (taskNameIsLink) {
				displayTaskName = taskNameIsLink[0];
			}

			const taskTime = taskDetails[taskName].taskDueString;
			const taskId = taskDetails[taskName].taskId;

			if (new Date() > new Date(taskTime)) {
				const lateNextTaskDiv = document.createElement('div');
				lateNextTaskDiv.id = taskId;
				lateNextTaskDiv.ariaLabel = taskDesc;
				lateNextTaskDiv.setCssStyles({
					'marginLeft': '10px',
					'display': 'flex',
					'flex': '0 1 75px',
					'alignItems': 'center'
				});
				lateNextTaskDiv.onmouseenter = () => {
					lateNextTaskDiv.style.background = 'darkslategray'
				}
				lateNextTaskDiv.onmouseleave = () => {
					lateNextTaskDiv.style.background = 'none'
				}


				const lateTaskDataCheckbox = document.createElement('input');
				lateTaskDataCheckbox.type = 'checkbox';

				const taskNameIsLink = taskName.match(/(?<=\[)[\s\S]+?(?=\]\([\s\S]+?\))/g);
				const linkUrlMatch = taskName.match(/(?<=\[[\s\S]+\]\()[\s\S]+?(?=\))/g);
				let lateTaskDataSpan: HTMLElement;
				if (taskNameIsLink && linkUrlMatch) {
					// If the task name is a link, create a clickable heading
					lateTaskDataSpan = this.container.createEl('span');
					const anchor = lateTaskDataSpan.createEl('a', { href: linkUrlMatch[0], text: taskNameIsLink[0] });
					anchor.setAttrs({
						'target': '_blank',
						'class': 'internal-link'
					}); // Opens the link in a new tab
					anchor.onmouseenter = async () => {
						anchor.style.cursor = 'pointer';
					}
					anchor.onmouseleave = async () => {
						anchor.style.cursor = 'none';
					}
				} else {
					// If it's not a link, create a regular heading
					lateTaskDataSpan = this.container.createEl('span', { text: taskName });
				}
				lateTaskDataSpan.setCssStyles({
					'display': 'flex',
					'fontWeight': 'bolder',
					'color': 'red !important',
					'marginLeft': '10px',
					'marginRight': '10px',
					'textAlign': 'justify',
					'fontSize': '1.5vw',
					'flex': '1 1',
					'justifyContent': 'flex-start',
					'whiteSpace': 'nowrap',
					'overflowY': 'auto'
				});

				const lateTaskDataTimeSpan = document.createElement('span');
				lateTaskDataTimeSpan.classList.add('home-settings-body-value');
				lateTaskDataTimeSpan.textContent = this.plugin.todoistInitializor?.getRelativeTimeString(taskTime)
					.replace(/ hours?/, 'h')
					.replace(/ minutes?/, 'm')
					.replace(/ seconds?/, 's')
					.trim() ?? '';
				lateTaskDataTimeSpan.setCssStyles({ 'marginLeft': '10px' });

				const lateTaskDataViewBtn = document.createElement('button');
				lateTaskDataViewBtn.textContent = 'View';
				lateTaskDataViewBtn.setCssStyles({ 'marginLeft': '10px' });

				const lateTaskDataDeleteBtn = document.createElement('button');
				lateTaskDataDeleteBtn.textContent = 'Delete';

				lateTaskDataCheckbox.addEventListener('change', async () => {
					const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken ?? '');
					let response;
					if (todoistApi) response = await todoistApi.closeTask(taskId);
					if (response && todoistApi) {
						new Notice(`${taskName} IS NOW COMPLETE 🎉`, 0);
						this.lastCompletedTask = taskId;
						await this.reloadAll();
					} else {
						console.error(`Unable to obtain the details of ${taskName}: `, response);
					}
				});

				lateTaskDataViewBtn.onclick = async () => {
					const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken as string);
					let response;
					if (todoistApi && taskId) response = await todoistApi.getTask(taskId);
					else response = this.taskObj;
					if (this.taskViewer) new this.taskViewer(this.app, this.plugin, response).open();
				};

				lateTaskDataDeleteBtn.onclick = async () => {
					if (confirm(`Are you sure you want to delete "${taskName}"? This cannot be undone.`)) {
						//console.log(this.plugin.todoistToken);
						const todoistApi = this.plugin.todoistInitializor?.todoistApi ?? new TodoistApi(this.plugin.todoistToken ?? '');
						let response;
						if (todoistApi) response = await todoistApi.deleteTask(taskId);
						if (response) {
							new Notice(`Deleted "${taskName}"`, 0);
							await this.reloadAll();
						} else {
							new Notice(`Error deleting "${taskName}"\nCheck the developer console.`, 0);
							console.error(response);
						}
					}
				};

				lateNextTaskDiv.append(lateTaskDataCheckbox, lateTaskDataSpan, lateTaskDataTimeSpan, lateTaskDataViewBtn, lateTaskDataDeleteBtn);
				this.overdueTaskDiv.appendChild(lateNextTaskDiv);
			}
		});
	}

	async reloadAll() {
		//console.log(`reloading...`)
		if (this.plugin.todoistInitializor) await this.plugin.todoistInitializor?.apiGrabber(true); //this.plugin.todoistInitializor?.apiGrabber(true);
		else {
			this.plugin.todoistInitializor = new TaskTracker(this.app, this.plugin, this.plugin.settings.apiKey);
			await this.plugin.todoistInitializor.apiGrabber(true);
		}

		const taskData = this.plugin.todoistInitializor;
		const currentTaskName = taskData?.closestTaskName ?? 'None';
		const currentTaskTimeString = taskData?.closestTaskTime ?? 'N/A';
		const currentTaskId = taskData?.closestTaskId ?? '';
		const tasksOverdueCount = taskData?.overDueCount ?? 0;
		const upcomingTasks = Object(taskData?.upcomingTasks) ?? {};
		const lateTasks = Object(taskData?.lateTasks) ?? {};

		this.currentTaskName = currentTaskName;
		this.currentTaskTime = currentTaskTimeString;
		this.currentTaskId = currentTaskId;
		this.tasksOverdueCount = tasksOverdueCount;
		this.upcomingTasks = upcomingTasks;
		this.lateTasks = lateTasks;

		// Update all elements
		await this.onOpen();
	}

	async logTaskCompletions(task: Task) {
		const file = this.app.vault.getAbstractFileByPath('utils/TaskCompletionLog.md');
		if (file instanceof TFile) {
			let existingCompletionData = await this.app.vault.read(file);
			const data = existingCompletionData?.match(/(?<=^\`\`\`json\n)[\s\S]*(?=\n^\`\`\`$)/gm);
			if (data) existingCompletionData = data[0];
			else existingCompletionData = '';
			const prettyAccessData = JSON.stringify(task, null, 4);
			const vaultAccessFormat = `\`\`\`json\n${prettyAccessData},\n${existingCompletionData}\n\`\`\``;
			await this.app.vault.modify(file, vaultAccessFormat);
		}
	}

	onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string) {
		if (source == "more-options" || source == "tab-header") {
			super.onPaneMenu(menu, source);
			menu.addItem((item) => {
				item
				.setTitle('Task View')
				.setIcon("smile")
				.onClick(async () => {
					const existingLeaves = this.app.workspace.getLeavesOfType('task-view');
					if (existingLeaves[0]) {
						this.app.workspace.moveLeafToPopout(existingLeaves[0]);
					} else {
						await this.plugin.activateView(['task-view'], true);
					}
				})
				.setSection("open");
			});
			return;
		}
		// In other cases, keep the original behavior
		super.onPaneMenu(menu, source);
	}

	async onClose(): Promise<void> {
		this.container?.empty();
	}

}
