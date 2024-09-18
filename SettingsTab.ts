import { App, PluginSettingTab, Setting, ToggleComponent, ButtonComponent, SliderComponent, Notice } from "obsidian";
import { Settings } from "Settings";
import ProjectsHTMLInjector from "main";
import { MenuSuggester } from 'utils/SuggesterMenu';

export class SettingsTab extends PluginSettingTab {
    app: App;
    plugin: ProjectsHTMLInjector;

    apiKeySetting: Setting;
    savedMdSetting: Setting;
    intervalSliderSetting: Setting;
    pgpPublicPathSetting: Setting;
    pgpPrivatePathSetting: Setting;
    allKeysPathSetting: Setting;
    allPrivateKeysPathSetting: Setting; // NOTE: 
    privateKeyPassPhrase: Setting;

    mdData: HTMLTextAreaElement;
    apiKeyInput: HTMLInputElement;
    pgpPrivatePathInput: HTMLInputElement;
    pgpPublicPathInput: HTMLInputElement;
    allKeysPathInput: HTMLInputElement;
    allPrivateKeysPathInput: HTMLInputElement; // NOTE: 
    passPhraseInput: HTMLInputElement;

    toggleApiKey: ToggleComponent;

    submitButton: ButtonComponent;
    submitPrivatePgpButton: ButtonComponent;
    submitPublicPgpButton: ButtonComponent;
    submitAllKeysButton: ButtonComponent;
    submitAllPrivateKeysButton: ButtonComponent; // NOTE: 
    submitPassPhraseButton: ButtonComponent;

    viewButton: ButtonComponent;
    viewPublicPgpButton: ButtonComponent;
    viewPrivatePgpButton: ButtonComponent;
    viewAllKeysButton: ButtonComponent;
    viewAllPrivateKeysButton: ButtonComponent; // NOTE:
    viewPassPhraseButton: ButtonComponent;

    intervalSlider: SliderComponent;

    privateSuggesterMenu: MenuSuggester;
    publicSuggesterMenu: MenuSuggester;

	constructor(app: App, plugin: ProjectsHTMLInjector) {
		super(app, plugin);
		this.plugin = plugin;
	}

    // Display function in settings tabs
	display(): void {
		// Container Element
		const {containerEl} = this;
		// Clear continer element
		containerEl.empty();
		containerEl.style.overscrollBehaviorY = 'auto';
        
        const mainHeading = containerEl.createEl('h1', { 'text': 'Custom Injector Settings' });
        const todoistSubheading = containerEl.createEl('h2', { 'text': 'Todoist Configuration' });
        todoistSubheading.setCssStyles({
            'fontSize': '25px'
        });
        this.apiKeySetting = new Setting(containerEl)
            .addText((text) => {
                text
                    .setPlaceholder('Todoist API Key')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value;
                        await new Settings(this.plugin).saveSettings();
                    })
                    .inputEl.type = 'password';
                this.apiKeyInput = text.inputEl;
                this.apiKeyInput.disabled = !!this.plugin.settings.apiKey; // Disable input if API key exists
            })
            .setName('Todoist API Key').setHeading();

        // Submit/Change Button
        this.apiKeySetting.addButton((button) => {
            button.setButtonText(this.plugin.settings.apiKey ? 'Change' : 'Submit')
                .onClick(async () => {
                    if (this.apiKeyInput.disabled) {
                        // Enable input and change button text
                        this.apiKeyInput.disabled = false;
                        this.apiKeyInput.type = 'text';
                        this.apiKeyInput.focus();
                        button.setButtonText('Submit');
                    } else {
                        // Save API key and disable input
                        this.plugin.settings.apiKey = this.apiKeyInput.value;
                        this.apiKeyInput.type = 'password';
                        await new Settings(this.plugin).saveSettings();
                        this.apiKeyInput.disabled = true;
                        button.setButtonText('Change');
                        new Notice(`API Key successfully saved.`);
                    }
                });
            this.submitButton = button;
        });
        // View Button
        this.apiKeySetting.addButton((button) => {
            button.setButtonText('View')
                .onClick(async () => {
                    if (this.apiKeyInput.type === 'password') {
                        this.viewButton.buttonEl.textContent = 'Hide';
                        this.apiKeyInput.type = 'text';
                    } else {
                        this.viewButton.buttonEl.textContent = 'View';
                        this.apiKeyInput.type = 'password';
                    }
                });
            this.viewButton = button;
        });

        // Slider for update interval
        this.intervalSliderSetting = new Setting(containerEl)
            .setName('Update Interval')
            .setDesc('Set the interval (in minutes) for updating Todoist tasks.')
            .addSlider((slider) => {
                slider.setLimits(1, 60, 1)  // Range from 1 to 60 minutes
                    .setValue(this.plugin.settings.updateInterval || 1)  // Default to 15 if undefined
                    .setDynamicTooltip()  // Shows the current value as a tooltip
                    .onChange(async (value) => {
                        this.plugin.settings.updateInterval = value;
                        await new Settings(this.plugin).saveSettings();
                    });
                this.intervalSlider = slider;
            });

        this.apiKeyInput.setCssStyles({
            'width': '100%'
        })
        this.apiKeySetting.controlEl.setCssStyles({
            'display': 'flex',
            'justifyContent': 'left',
            'marginLeft': '5px'
        });

        this.savedMdSetting = new Setting(containerEl);

        const pgpSubheading = containerEl.createEl('h2', { 'text': 'PGP Configuration' });
        pgpSubheading.setCssStyles({
            'fontSize': '25px'
        });

        this.pgpPrivatePathSetting = new Setting(containerEl)
            .addText((text) => {
                text
                    .setPlaceholder('Private PGP File Path')
                    .setValue(this.plugin.settings.pgpPrivatePath)
                    .onChange(async (value) => {
                        this.plugin.settings.pgpPrivatePath = value;
                        await new Settings(this.plugin).saveSettings();
                    })
                    .inputEl.type = 'password';
                this.pgpPrivatePathInput = text.inputEl;
                this.pgpPrivatePathInput.disabled = true;
            })
            .setName('Private PGP Path').setHeading();

        const privateSuggestionContainer: HTMLElement = containerEl.createEl('ul', { cls: 'folder-suggestions' });
        // this.privateSuggesterMenu = new MenuSuggester(this.app, this.pgpPublicPathInput, privateSuggestionContainer);
        this.pgpPrivatePathSetting.addButton((button) => {
            button.setButtonText('Change')
                .onClick(async () => {
                    if (this.pgpPrivatePathInput.disabled) {
                        // Enable input and change button text
                        this.pgpPrivatePathInput.disabled = false;

                         this.privateSuggesterMenu = new MenuSuggester(this.app, containerEl, this.pgpPrivatePathInput, privateSuggestionContainer, 'asc');
                        await this.privateSuggesterMenu.onOpen();

                        this.pgpPrivatePathInput.type = 'text';
                        this.pgpPrivatePathInput.focus();
                        button.setButtonText('Submit');
                    } else {
                        this.plugin.settings.pgpPrivatePath = this.pgpPrivatePathInput.value;
                        this.pgpPrivatePathInput.type = 'password';
                        await new Settings(this.plugin).saveSettings();
                        this.pgpPrivatePathInput.disabled = true;
                        button.setButtonText('Change');
                        new Notice(`PGP File Path successfully saved.`);
                        //this.suggesterMenu.onClose();
                    }
                });
            this.submitPrivatePgpButton = button;
        });
        // View Button
        this.pgpPrivatePathSetting.addButton((button) => {
            button.setButtonText('View')
                .onClick(async () => {
                    if (this.pgpPrivatePathInput.type === 'password') {
                        this.viewPrivatePgpButton.buttonEl.textContent = 'Hide';
                        this.pgpPrivatePathInput.type = 'text';
                    } else {
                        this.viewPrivatePgpButton.buttonEl.textContent = 'View';
                        this.pgpPrivatePathInput.type = 'password';
                    }
                });
            this.viewPrivatePgpButton = button;
        });
        this.pgpPrivatePathInput.setCssStyles({
            'width': '100%'
        })
        this.pgpPrivatePathSetting.controlEl.setCssStyles({
            'display': 'flex',
            'justifyContent': 'left',
            'marginLeft': '5px'
        });


        this.pgpPublicPathSetting = new Setting(containerEl)
            .addText((text) => {
                text
                    .setPlaceholder('Public PGP File Path')
                    .setValue(this.plugin.settings.pgpPublicPath)
                    .onChange(async (value) => {
                        this.plugin.settings.pgpPublicPath = value;
                        await new Settings(this.plugin).saveSettings();
                    })
                    .inputEl.type = 'password';
                this.pgpPublicPathInput = text.inputEl;
                this.pgpPublicPathInput.disabled = true;
            })
            .setName('Public PGP Path').setHeading();

        const publicSuggestionContainer: HTMLElement = containerEl.createEl('ul', { cls: 'folder-suggestions' });
        this.pgpPublicPathSetting.addButton((button) => {
            button.setButtonText('Change')
                .onClick(async () => {
                    if (this.pgpPublicPathInput.disabled) {
                        // Enable input and change button text
                        this.pgpPublicPathInput.disabled = false;

                        this.publicSuggesterMenu = new MenuSuggester(this.app, containerEl, this.pgpPublicPathInput, publicSuggestionContainer, 'asc');
                        await this.publicSuggesterMenu.onOpen();

                        this.pgpPublicPathInput.type = 'text';
                        this.pgpPublicPathInput.focus();
                        button.setButtonText('Submit');
                    } else {
                        this.plugin.settings.pgpPublicPath = this.pgpPublicPathInput.value;
                        this.pgpPublicPathInput.type = 'password';
                        await new Settings(this.plugin).saveSettings();
                        this.pgpPublicPathInput.disabled = true;
                        button.setButtonText('Change');
                        new Notice(`PGP File Path successfully saved.`);
                        //this.suggesterMenu.onClose();
                    }
                });
            this.submitPublicPgpButton = button;
        });
        // View Button
        this.pgpPublicPathSetting.addButton((button) => {
            button.setButtonText('View')
                .onClick(async () => {
                    if (this.pgpPublicPathInput.type === 'password') {
                        this.viewPublicPgpButton.buttonEl.textContent = 'Hide';
                        this.pgpPublicPathInput.type = 'text';
                    } else {
                        this.viewPublicPgpButton.buttonEl.textContent = 'View';
                        this.pgpPublicPathInput.type = 'password';
                    }
                });
            this.viewPublicPgpButton = button;
        });
        this.pgpPublicPathInput.setCssStyles({
            'width': '100%'
        });
        this.pgpPublicPathSetting.controlEl.setCssStyles({
            'display': 'flex',
            'justifyContent': 'left',
            'marginLeft': '5px'
        });


        // passPhraseInput - viewPassPhraseButton - submitPassPhraseButton - passPhraseInput - privateKeyPassPhrase
        this.privateKeyPassPhrase = new Setting(containerEl)
            .addText((text) => {
                text
                    .setPlaceholder('Private Key Passphrase')
                    .setValue(this.plugin.settings.privateKeyPassPhrase)
                    .onChange(async (value) => {
                        this.plugin.settings.privateKeyPassPhrase = value;
                        await new Settings(this.plugin).saveSettings();
                    })
                    .inputEl.type = 'password';
                this.passPhraseInput = text.inputEl;
                this.passPhraseInput.disabled = true;
            })
            .setName('Private Key Passphrase').setHeading();

        this.privateKeyPassPhrase.addButton((button) => {
            button.setButtonText('Change')
                .onClick(async () => {
                    if (this.passPhraseInput.disabled) {
                        // Enable input and change button text
                        this.passPhraseInput.disabled = false;
                        this.passPhraseInput.type = 'text';
                        this.passPhraseInput.focus();
                        button.setButtonText('Submit');
                    } else {
                        this.plugin.settings.privateKeyPassPhrase = this.passPhraseInput.value;
                        this.passPhraseInput.type = 'password';
                        await new Settings(this.plugin).saveSettings();
                        this.passPhraseInput.disabled = true;
                        button.setButtonText('Change');
                        new Notice(`Passphrase successfully saved.`);
                        //this.suggesterMenu.onClose();
                    }
                });
            this.submitPassPhraseButton = button;
        });
        // View Button
        this.privateKeyPassPhrase.addButton((button) => {
            button.setButtonText('View')
                .onClick(async () => {
                    if (this.passPhraseInput.type === 'password') {
                        this.viewPassPhraseButton.buttonEl.textContent = 'Hide';
                        this.passPhraseInput.type = 'text';
                    } else {
                        this.viewPassPhraseButton.buttonEl.textContent = 'View';
                        this.passPhraseInput.type = 'password';
                    }
                });
            this.viewPassPhraseButton = button;
        });
        this.passPhraseInput.setCssStyles({
            'width': '100%'
        });
        this.privateKeyPassPhrase.controlEl.setCssStyles({
            'display': 'flex',
            'justifyContent': 'left',
            'marginLeft': '5px'
        });

        // allKeysPathSetting - allKeysPathInput - submitAllKeysButton - viewAllKeysButton
        this.allKeysPathSetting = new Setting(containerEl)
            .addText((text) => {
                text
                    .setPlaceholder('All PGP Contacts File Path')
                    .setValue(this.plugin.settings.allKeysPathSetting)
                    .onChange(async (value) => {
                        this.plugin.settings.allKeysPathSetting = value;
                        await new Settings(this.plugin).saveSettings();
                    })
                    .inputEl.type = 'password';
                this.allKeysPathInput = text.inputEl;
                this.allKeysPathInput.disabled = true;
            })
            .setName('All Keys File Path').setHeading();

        const allSuggestionContainer: HTMLElement = containerEl.createEl('ul', { cls: 'folder-suggestions' });
        this.allKeysPathSetting.addButton((button) => {
            button.setButtonText('Change')
                .onClick(async () => {
                    if (this.allKeysPathInput.disabled) {
                        // Enable input and change button text
                        this.allKeysPathInput.disabled = false;
                        this.allKeysPathInput.type = 'text';
                        this.publicSuggesterMenu = new MenuSuggester(this.app, containerEl, this.allKeysPathInput, allSuggestionContainer, 'asc');
                        await this.publicSuggesterMenu.onOpen();
                        this.allKeysPathInput.focus();
                        button.setButtonText('Submit');
                    } else {
                        this.plugin.settings.allKeysPathSetting = this.allKeysPathInput.value;
                        this.allKeysPathInput.type = 'password';
                        await new Settings(this.plugin).saveSettings();
                        this.allKeysPathInput.disabled = true;
                        button.setButtonText('Change');
                        new Notice(`File path successfully saved.`);
                        //this.suggesterMenu.onClose();
                    }
                });
            this.submitAllKeysButton = button;
        });
        // View Button
        this.allKeysPathSetting.addButton((button) => {
            button.setButtonText('View')
                .onClick(async () => {
                    if (this.allKeysPathInput.type === 'password') {
                        this.viewAllKeysButton.buttonEl.textContent = 'Hide';
                        this.allKeysPathInput.type = 'text';
                    } else {
                        this.viewAllKeysButton.buttonEl.textContent = 'View';
                        this.allKeysPathInput.type = 'password';
                    }
                });
            this.viewAllKeysButton = button;
        });
        this.allKeysPathInput.setCssStyles({
            'width': '100%'
        });
        this.allKeysPathSetting.controlEl.setCssStyles({
            'display': 'flex',
            'justifyContent': 'left',
            'marginLeft': '5px'
        });


        // allPrivateKeysPathSetting - allPrivateKeysPathInput - submitAllPrivateKeysButton - viewAllPrivateKeysButton
        this.allPrivateKeysPathSetting = new Setting(containerEl)
            .addText((text) => {
                text
                    .setPlaceholder('All Private PGP Keys File Path')
                    .setValue(this.plugin.settings.allPrivateKeysPathSetting)
                    .onChange(async (value) => {
                        this.plugin.settings.allPrivateKeysPathSetting = value;
                        await new Settings(this.plugin).saveSettings();
                    })
                    .inputEl.type = 'password';
                this.allPrivateKeysPathInput = text.inputEl;
                this.allPrivateKeysPathInput.disabled = true;
            })
            .setName('All Private Keys File Path').setHeading();

        const allPrivateSuggestionContainer: HTMLElement = containerEl.createEl('ul', { cls: 'folder-suggestions' });
        this.allPrivateKeysPathSetting.addButton((button) => {
            button.setButtonText('Change')
                .onClick(async () => {
                    if (this.allPrivateKeysPathInput.disabled) {
                        // Enable input and change button text
                        this.allPrivateKeysPathInput.disabled = false;
                        this.allPrivateKeysPathInput.type = 'text';
                        this.publicSuggesterMenu = new MenuSuggester(this.app, containerEl, this.allPrivateKeysPathInput, allPrivateSuggestionContainer, 'asc');
                        await this.publicSuggesterMenu.onOpen();
                        this.allPrivateKeysPathInput.focus();
                        button.setButtonText('Submit');
                    } else {
                        this.plugin.settings.allPrivateKeysPathSetting = this.allPrivateKeysPathInput.value;
                        this.allPrivateKeysPathInput.type = 'password';
                        await new Settings(this.plugin).saveSettings();
                        this.allPrivateKeysPathInput.disabled = true;
                        button.setButtonText('Change');
                        new Notice(`File path successfully saved.`);
                        //this.suggesterMenu.onClose();
                    }
                });
            this.submitAllPrivateKeysButton = button;
        });
        // View Button
        this.allPrivateKeysPathSetting.addButton((button) => {
            button.setButtonText('View')
                .onClick(async () => {
                    if (this.allPrivateKeysPathInput.type === 'password') {
                        this.viewAllPrivateKeysButton.buttonEl.textContent = 'Hide';
                        this.allPrivateKeysPathInput.type = 'text';
                    } else {
                        this.viewAllPrivateKeysButton.buttonEl.textContent = 'View';
                        this.allPrivateKeysPathInput.type = 'password';
                    }
                });
            this.viewAllPrivateKeysButton = button;
        });
        this.allPrivateKeysPathInput.setCssStyles({
            'width': '100%'
        });
        this.allPrivateKeysPathSetting.controlEl.setCssStyles({
            'display': 'flex',
            'justifyContent': 'left',
            'marginLeft': '5px'
        });
    }
}
