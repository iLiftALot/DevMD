import { App, TFile } from 'obsidian';
import ProjectsHTMLInjector from 'main';

export type ExtensionFilterType = 'md' | 'pdf' | 'jpeg' | 'png' | 'gpg' | 'asc';
export type ExtensionFilter = ExtensionFilterType | ExtensionFilterType[] | undefined;

export type ListenerType = string;
export type ListenerSource = HTMLElement;
export type ListenerCallback = (ev: Event) => any;
export type EventListener = {
    listenerType: ListenerType,
    listenerSource: ListenerSource,
    listenerCallback: ListenerCallback
}
export type EventListeners = EventListener[];

export class MenuSuggester {
	app: App;
	plugin: ProjectsHTMLInjector;
    mainElement: HTMLElement;
	inputElement: HTMLInputElement;
	suggestionContainer: HTMLElement;
	folderPaths: string[];
	currentOptionIndex: number;
	currentOption: HTMLElement | null;
    extensionFilter: ExtensionFilter;
    eventListeners: EventListeners;

	constructor(app: App, mainElement: HTMLElement, inputElement: HTMLInputElement, suggestionContainer: HTMLElement, extensionFilter?: ExtensionFilter) {
		this.app = app;
        this.mainElement = mainElement;
		this.inputElement = inputElement;
		this.suggestionContainer = suggestionContainer;
        this.extensionFilter = extensionFilter;
		this.folderPaths = [];
		this.currentOptionIndex = -1;
		this.currentOption = null;
        this.eventListeners = [];
	}

	// Open method to initialize folder suggestions
	async onOpen(): Promise<void> {
		this.folderPaths = await this.fetchSuggestionsFromVault(); // Fetch folder paths
		this.addEventListeners(); // Add input and keyboard event listeners
	}

	// Fetch folder paths from the vault (handled internally)
	async fetchSuggestionsFromVault(): Promise<string[]> {
		let folders = this.app.vault.getAllLoadedFiles()
            .filter(file => file instanceof TFile);
        if (this.extensionFilter) {
            folders = folders.filter(folderOrFile => {
                const ext = folderOrFile.extension;
                return !Array.isArray(this.extensionFilter)
                    ? folderOrFile.extension === this.extensionFilter
                    : this.extensionFilter.includes(folderOrFile.extension as 'md' | 'pdf' | 'jpeg' | 'png' | 'gpg' | 'asc');
            });
        }
		return folders.map(folderOrFile => folderOrFile.path);
	}

	// Handle input events and populate suggestions
	addEventListeners(): void {
		this.inputElement.addEventListener('input', (event: KeyboardEvent) => {
			this.populateSuggestions(this.inputElement.value);
		});
		
		this.inputElement.addEventListener('keydown', (event: KeyboardEvent) => {
			this.handleKeydown(event);
		});

		this.inputElement.addEventListener('focusin', (event: FocusEvent) => {
			this.populateSuggestions(this.inputElement.value);
		});

		this.suggestionContainer.addEventListener('click', (event: MouseEvent) => {
            const target = (event.target as HTMLElement).closest('li'); // Ensure we are targeting the LI element
            if (target) {
                this.inputElement.value = target.textContent || ''; // Set the input value to the clicked suggestion
                this.inputElement.focus(); // Refocus the input element
            }
        });

        this.mainElement.addEventListener('click', (event: MouseEvent) => {
            const target = (event.target as HTMLElement).closest('li') || (event.target as HTMLElement).closest('input');
            if (!target) this.suggestionContainer.style.display = 'none';
        });

        this.eventListeners.push(
            {
                listenerType: 'input',
                listenerSource: this.inputElement,
                listenerCallback: (event: KeyboardEvent) => {
                    this.populateSuggestions(this.inputElement.value);
                }
            },
            {
                listenerType: 'keydown',
                listenerSource: this.inputElement,
                listenerCallback: (event: KeyboardEvent) => {
                    this.handleKeydown(event);
                }
            },
            {
                listenerType: 'focusin',
                listenerSource: this.inputElement,
                listenerCallback: (event: FocusEvent) => {
                    this.populateSuggestions(this.inputElement.value);
                }
            },
            {
                listenerType: 'click',
                listenerSource: this.suggestionContainer,
                listenerCallback:(event: MouseEvent) => {
                    const target = (event.target as HTMLElement).closest('li'); // Ensure we are targeting the LI element
                    if (target) {
                        this.inputElement.value = target.textContent || ''; // Set the input value to the clicked suggestion
                        this.inputElement.focus(); // Refocus the input element
                    }
                }
            },
            {
                listenerType: 'click',
                listenerSource: this.mainElement,
                listenerCallback: (event: MouseEvent) => {
                    const target = (event.target as HTMLElement).closest('li'); // Ensure we are targeting the LI element
                    if (target) {
                        this.inputElement.value = target.textContent || ''; // Set the input value to the clicked suggestion
                        this.inputElement.focus(); // Refocus the input element
                    }
                }
            }
        );

	}

	// Populate suggestion dropdown
	populateSuggestions(inputValue: string): void {
		this.suggestionContainer.innerHTML = ''; // Clear previous suggestions

		const matchingFolders = this.folderPaths
			.filter(folder => folder.toLowerCase().includes(inputValue.toLowerCase()))
			.sort();

		if (matchingFolders.length > 0) {
			this.suggestionContainer.style.display = 'block';
			matchingFolders.forEach(folder => {
				const suggestionItem = document.createElement('li');
				suggestionItem.textContent = folder;
				suggestionItem.classList.add('suggestion-item');
				suggestionItem.addEventListener('click', () => {
					this.selectSuggestion(suggestionItem);
				});
				this.suggestionContainer.appendChild(suggestionItem);
			});
		} else {
			this.suggestionContainer.style.display = 'none';
		}
	}

	// Handle keyboard navigation and selection
	handleKeydown(event: KeyboardEvent): void {
        const tooHigh = this.currentOptionIndex + 1 > this.suggestionContainer.children.length - 1;
        const tooLow = this.currentOptionIndex - 1 < 0;
		if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (tooHigh) {
                this.currentOptionIndex = 0;
            } else {
                this.currentOptionIndex = this.currentOptionIndex + 1;
            }
			this.updateHighlight();
		} else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (tooLow) {
                this.currentOptionIndex = this.suggestionContainer.children.length - 1;
            } else {
                this.currentOptionIndex = this.currentOptionIndex - 1;
            }
			this.updateHighlight();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const selectedOption = this.suggestionContainer.children[this.currentOptionIndex] as HTMLElement;
			this.selectSuggestion(selectedOption);
		}
	}

	// Highlight the current option in the list
	updateHighlight(): void {
		Array.from(this.suggestionContainer.children).forEach((child, index) => {
			const item = child as HTMLElement;
			if (index === this.currentOptionIndex) {
				item.classList.add('highlight');
				item.scrollIntoView({ block: 'nearest' });
			} else {
				item.classList.remove('highlight');
			}
		});
	}

	// Select a suggestion (either via click or keyboard)
	selectSuggestion(suggestionItem: HTMLElement): void {
		this.inputElement.value = suggestionItem.textContent || '';
		this.suggestionContainer.style.display = 'none';
		this.currentOptionIndex = -1;
		this.currentOption = null;
	}

    removeEventListeners(): void {
        this.eventListeners.forEach(({ listenerType, listenerSource, listenerCallback }) => {
            listenerSource.removeEventListener(listenerType, listenerCallback);
        });
    }

	// Cleanup when closing the suggester
	onClose(): void {
		this.suggestionContainer.innerHTML = '';
		this.suggestionContainer.style.display = 'none';
        this.removeEventListeners();
	}
}
