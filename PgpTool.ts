import { App, ItemView, WorkspaceLeaf, Notice, Modal, Setting, moment, ValueComponent, ProgressBarComponent } from 'obsidian';
import * as openpgp from 'openpgp';
import ProjectsHTMLInjector from '../main';
import { HTMLInjectSettings } from '../Settings';


export async function logGpg(app: App, plugin: ProjectsHTMLInjector) {
    const settings: HTMLInjectSettings = plugin.settings;
    const allKeysPath = settings.allKeysPathSetting;
    const data = await app.vault.adapter.read(allKeysPath);
    const keys = (await openpgp.readKeys({ armoredKeys: data }));
    console.log(keys);
}

export function isPgp(text: string): boolean {
    const textToProcess = text.trim();
    const isPgp = textToProcess.match(/^-----.*?-----\n[\s\S]*?\n^-----.*?-----/gm);
    return isPgp !== null;
}

export class PGPTool extends ItemView {
    app: App;
    leaf: WorkspaceLeaf;
    private privateKey: openpgp.PrivateKey;
    private publicKey: openpgp.PublicKey;
    public plugin: ProjectsHTMLInjector;
    public deleteKeysBtn: HTMLButtonElement;
    public isPgp: (inputValue: string) => boolean;
    public openpgp: typeof openpgp;

    constructor(app: App, plugin: ProjectsHTMLInjector, leaf: WorkspaceLeaf) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;
        this.isPgp = isPgp;
        this.openpgp = openpgp;
    }

    getViewType(): string {
        return "pgp-tool";
    }

    getDisplayText(): string {
        return "PGP Tool";
    }

    getIcon(): string {
        return "lock";
    }

    async onOpen() {
        const { contentEl } = this;
        this.contentEl = contentEl;
        // Clear any previous content
        this.contentEl.empty();
        this.contentEl.createEl('h1', { text: 'PGP Tool' });
        // Add UI elements
        const sendAndSelectDiv = this.contentEl.createEl('div');
        sendAndSelectDiv.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'gap': '5px',
            'paddingBottom': '20px',
            'alignItems': 'center',
            'justifyContent': 'center',
            'width': '100%'
        });
        const sendDiv = this.contentEl.createEl('div');
        sendDiv.setCssStyles({
            'display': 'flex',
            'width': '100%',
            'alignItems': 'center',
            'justifyContent': 'center',
            'gap': '5px'
        });
        const recieveDiv = this.contentEl.createEl('div');
        recieveDiv.setCssStyles({
            'display': 'flex',
            'width': '100%',
            'justifyContent': 'center',
            'gap': '5px'
        });

        const sendReceiveContainer = this.contentEl.createEl('div');
        sendReceiveContainer.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'alignItems': 'center',
            'alignContent': 'center',
            'flexWrap': 'wrap',
            'width': '100%'
        });
        const sendingKeyHeader = this.contentEl.createEl('h4', { text: 'Select Private Key' });
        sendingKeyHeader.style.alignSelf = 'center';
        const sendingKeySelect = this.contentEl.createEl("select", { attr: { id: "sendingKey" } });
        const receivingKeyHeader = this.contentEl.createEl('h4', { text: 'Select Public Key(s)' });
        receivingKeyHeader.style.alignSelf = 'center';
        const receivingKeySelect = this.contentEl.createEl("select", { attr: { multiple: "true", id: "receivingKeys" } });
        sendingKeySelect.setCssStyles({
            'textAlign': 'center',
            'height': '30px',
            'width': '100%',
            'fontSize': 'large',
            'padding': '0'
        });
        receivingKeySelect.setCssStyles({
            'textAlign': 'center',
            'fontSize': 'large',
            'height': 'max-content',
            'width': '100%',
            'padding': '0 0 0 0'
        });

        const keyDiv = this.contentEl.createEl('div');
        keyDiv.setCssStyles({
            'display': 'flex',
            'gap': '5px'
        });
        const importKeysBtn = this.contentEl.createEl('button', { text: 'Import Key' });
        const refreshKeysBtn = this.contentEl.createEl('button', { text: 'Refresh Keys' });
        const createNewKeyBtn = this.contentEl.createEl('button', { text: 'Create New Key' });
        this.deleteKeysBtn = this.contentEl.createEl('button', { text: 'Delete Key(s)' });
        this.deleteKeysBtn.disabled = receivingKeySelect.selectedIndex !== -1 ? true : false;

        keyDiv.append(importKeysBtn, refreshKeysBtn, createNewKeyBtn, this.deleteKeysBtn);
        sendDiv.append(sendingKeyHeader, sendingKeySelect);
        recieveDiv.append(receivingKeyHeader, receivingKeySelect);
        sendReceiveContainer.append(keyDiv, sendDiv, recieveDiv);
        sendAndSelectDiv.append(sendReceiveContainer);

        const checkboxDiv = this.contentEl.createEl('div');
        checkboxDiv.setCssStyles({
            'display': 'flex',
            'alignItems': 'center',
            'justifyContent': 'center',
            'gap': '20px'
        });
        const shouldSignHeader = this.contentEl.createEl('h4', { text: 'Sign Messages' });
        const shouldSignMessage = this.contentEl.createEl('input', { type: 'checkbox' });
        shouldSignMessage.style.marginLeft = '5px';
        shouldSignMessage.checked = this.plugin.settings.signMessage;
        shouldSignMessage.onclick = async (event: MouseEvent) => {
            this.plugin.settings.signMessage = shouldSignMessage.checked;
            await this.plugin.saveData(this.plugin.settings);
        }
        const shouldVerifyHeader = this.contentEl.createEl('h4', { text: 'Verify Signatures' });
        const shouldVerifyMessage = this.contentEl.createEl('input', { type: 'checkbox' });
        shouldVerifyMessage.style.marginLeft = '5px';
        shouldVerifyMessage.checked = this.plugin.settings.verifyMessage;
        shouldVerifyMessage.onclick = async (event: MouseEvent) => {
            this.plugin.settings.verifyMessage = shouldVerifyMessage.checked;
            await this.plugin.saveData(this.plugin.settings);
        }

        checkboxDiv.append(shouldSignHeader, shouldSignMessage, shouldVerifyHeader, shouldVerifyMessage);

        const encryptAndDecryptDiv = this.contentEl.createEl('div');
        encryptAndDecryptDiv.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'paddingBottom': '20px',
            'height': '250px',
            'resize': 'vertical'
        });

        const pgpContentDiv = this.contentEl.createEl('div');
        pgpContentDiv.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'width': '100%',
            'height': '100%'
        });

        const pgpInput = this.contentEl.createEl('textarea', {
            placeholder: 'Enter text to encrypt...',
            cls: 'pgp-input',
            attr: { placeholder: 'Text to to process for encryption and decryption...' }
        });

        pgpInput.setCssStyles({
            'height': '100%',
            'resize': 'vertical'
        });
        const processButton = this.contentEl.createEl(
            'button',
            { text:!this.isPgp(pgpInput.value.trim()) ? 'Encrypt' : 'Decrypt' }
        );
        processButton.setCssStyles({
            'display': pgpInput.value.trim().length > 0 ? 'flex' : 'none',
            'fontSize': 'larger'
        });

        pgpInput.addEventListener('input', (event: InputEvent) => {
            const textToProcess = pgpInput.value.trim();
            if (textToProcess.length > 0) {
                processButton.style.display = 'flex';
                processButton.textContent = !this.isPgp(textToProcess) ? 'Encrypt' : 'Decrypt';
            }
            else processButton.style.display = 'none';
        });
        pgpContentDiv.append(pgpInput, processButton);
        encryptAndDecryptDiv.append(pgpContentDiv);
        const outputArea = this.contentEl.createEl('textarea', {
            placeholder: 'Output...',
            cls: 'pgp-output',
            attr: { 'readOnly': true, 'id': 'output-area' }
        });

        const outputDiv = this.contentEl.createEl('div');
        outputDiv.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'alignItems': 'center',
            'height': '100%'
        });
        outputArea.setCssStyles({
            'width': '100%',
            'height': '100%',
            'caretColor': 'transparent'
        });

        outputDiv.appendChild(outputArea);
        // Add event listeners for encryption and decryption
        importKeysBtn.onclick = (event: MouseEvent) => {
            new PGPImporter(this.app, this.plugin, this.importKey.bind(this), this.importPrivateKey.bind(this)).open();
        }
        refreshKeysBtn.onclick = async () => {
            await this.loadAndDisplayKeys();
        }
        createNewKeyBtn.onclick = () => {
            new CreateKeyModal(this.app, this).open();
        }
        this.deleteKeysBtn.onclick = async () => {
            const selectedKeys = this.plugin.settings.pgpConfig.receivingKeys;
            if (selectedKeys.length > 0 && !this.deleteKeysBtn.disabled) {
                await this.deletePGPKeys();
                this.deleteKeysBtn.disabled = true;
            }
        }

        processButton.onclick = async () => {
            // Load keys if they haven't been loaded yet
            if (!this.publicKey || !this.privateKey) await this.loadKeys();

            // Get the text input from the user
            const textToProcess = pgpInput.value.trim();
            const { sendingKeySelect, receivingKeysSelect } = this.getSelectElements();
            const { privateKeys, publicKeys } = await this.getPGPKeys();

            // Get the selected key from the UI (assuming you have a way to select the key in the UI)
            const selectedPrivateUserId = sendingKeySelect.options[sendingKeySelect.selectedIndex].text;  // Implement this to fetch the selected private key
            const selectedPrivateKey = privateKeys.find((key) => key.getUserIDs()[0] === selectedPrivateUserId);

            if (!selectedPrivateKey) {
                new Notice('No private key selected or found.');
                return;
            }

            // If the text is not in PGP format, encrypt the text
            if (!this.isPgp(textToProcess)) {
                if (textToProcess) {
                    const encryptedText = await this.encryptText(textToProcess);
                    outputArea.value = encryptedText;
                    await navigator.clipboard.writeText(encryptedText);
                    new Notice('✅ Encrypted Message Copied to Clipboard.');
                } else {
                    new Notice('Please enter text to encrypt.');
                }
            } else {
                // If text is in PGP format, attempt to decrypt it
                if (textToProcess) {
                    const decryptedText = await this.decryptText(textToProcess, selectedPrivateKey);
                    outputArea.value = decryptedText;
                    await navigator.clipboard.writeText(decryptedText);
                    new Notice('✅ Decrypted Message Copied to Clipboard.');
                } else {
                    new Notice('Please enter encrypted text to decrypt.');
                }
            }
        };
        await this.loadKeys();
        await this.loadAndDisplayKeys();
    }

    async loadAndDisplayKeys() {
        const { publicKeys, privateKeys } = await this.getPGPKeys();
        this.populateKeyOptions(publicKeys, privateKeys);
    }

    getSelectElements() {
        const sendingKeySelect = this.contentEl.querySelector("#sendingKey") as HTMLSelectElement;
        const receivingKeysSelect = this.contentEl.querySelector("#receivingKeys") as HTMLSelectElement;
        return { sendingKeySelect, receivingKeysSelect };
    }

    async deletePGPKeys() {
        try {
            // Get the currently stored PGP keys (public and private)
            const { publicKeys, privateKeys } = await this.getPGPKeys();
            const { receivingKeysSelect } = this.getSelectElements();
            
            // Get the selected receiving keys (these are the ones to be deleted)
            const selectedReceivingKeys = Array.from(receivingKeysSelect.selectedOptions).map(option => option.text);
            const confirmDeletion = confirm(
                `Are you sure you want to delete the following PGP keys?\n\n${
                    Array.from(receivingKeysSelect.selectedOptions).map((option, index) => `${index + 1}. ${option.text}`).join('\n\n')
                }`
            );
            if (!confirmDeletion) return;

            // Filter out the keys you want to delete based on their userID
            const filteredPublicKeys = publicKeys.filter(key => {
                const userID = key.getUserIDs()[0]; // Assuming the first userID is used for matching
                console.log(`Scanning for ${userID}........${!selectedReceivingKeys.includes(userID)}`)
                return !selectedReceivingKeys.includes(userID); // Keep keys that are not selected for deletion
            });

            // Repeat the same process for private keys if needed
            const filteredPrivateKeys = privateKeys.filter(key => {
                const userID = key.toPublic().getUserIDs()[0];
                return !selectedReceivingKeys.includes(userID); // Keep keys that are not selected for deletion
            });

            // Now that we've filtered out the keys to delete, you need to update the key storage
            // You can either re-armor and save the keys or update your configuration

            //filteredPublicKeys.map(key => {
            //    console.log(key.getUserIDs()[0])
            //})
            //filteredPrivateKeys.map(key => {
            //    console.log(key.getUserIDs()[0])
            //});
            // Convert keys to armored format
            const armoredPublicKeys = await this.getCombinedArmoredKey(filteredPublicKeys, false);
            const armoredPrivateKeys = await this.getCombinedArmoredKey(filteredPrivateKeys, true);

            // Save the updated public keys back to the file
            await this.app.vault.adapter.write(this.plugin.settings.allKeysPathSetting, armoredPublicKeys);
            // If you're also saving private keys, save them similarly
            await this.app.vault.adapter.write(this.plugin.settings.allPrivateKeysPathSetting, armoredPrivateKeys);

            // Update the plugin settings (remove deleted keys from config)
            this.plugin.settings.pgpConfig.receivingKeys = selectedReceivingKeys;
            await this.plugin.saveData(this.plugin.settings);

            // Optionally, refresh UI elements
            await this.loadAndDisplayKeys();
        } catch (error) {
            console.error('Error deleting PGP keys:', error);
        }
    }

    async getPGPKeys() {
        // Replace with the actual path to your key file
        const allKeysPath = this.plugin.settings.allKeysPathSetting;
        const allPrivateKeysPath = this.plugin.settings.allPrivateKeysPathSetting;

        const data = await this.app.vault.adapter.read(allKeysPath);
        const privateData = await this.app.vault.adapter.read(allPrivateKeysPath);

        const publicKeys = await openpgp.readKeys({ armoredKeys: data });
        const privateKeys = await openpgp.readPrivateKeys({ armoredKeys: privateData });
        return { publicKeys, privateKeys };
    }

    async populateKeyOptions(publicKeys: openpgp.Key[], privateKeys: openpgp.PrivateKey[]) {
        await this.loadKeys();
        const { sendingKeySelect, receivingKeysSelect } = this.getSelectElements();
        // Clear existing options in case the method is called multiple times
        sendingKeySelect.innerHTML = "";
        receivingKeysSelect.innerHTML = "";
        // console.log(Object.entries(privateKeys));

        const sortedPublicKeys = publicKeys.sort((a, b) => {
            const aKeyID = a.getUserIDs()[0];
            const bKeyID = b.getUserIDs()[0];
            return aKeyID.localeCompare(bKeyID);
        });

        sortedPublicKeys.forEach((key: openpgp.Key, index: number) => {
            const userID = key.users[0]?.userID?.userID || `Key ${index + 1}`;
            const privateKey: openpgp.PrivateKey | null = privateKeys[index];
            const privateUserID = privateKey ? privateKey.toPublic().getUserIDs()[0] : null;
            if (privateKey) {
                // Create option for sending key
                let sendingOption = document.createElement('option');
                sendingOption.value = String(index);
                sendingOption.text = privateUserID ?? 'Not Found';
                sendingKeySelect.add(sendingOption);
            }
            // Create option for receiving keys
            let receivingOption = document.createElement('option');
            receivingOption.setCssStyles({
                'width': '100%',
                'margin': '0px',
                'padding': '0px',
                'borderLeft': '2px solid black',
                'borderRight': '2px solid black',
                'borderTop': '2px solid black',
                'borderBottom': '2px solid black',
            });
            receivingOption.value = String(index);
            receivingOption.text = userID;
            receivingKeysSelect.add(receivingOption);
            receivingOption.onmouseenter = () => {
                receivingOption.style.backgroundColor = 'black';
                receivingOption.style.color = 'white';
            }
            receivingOption.onmouseleave = () => {
                receivingOption.style.backgroundColor = '';
                receivingOption.style.color = '';
            }
            receivingOption.onmouseup = () => {
                this.deleteKeysBtn.disabled = receivingKeysSelect.selectedIndex !== -1 ? false : true;
            }
        });
        // Listen for changes on the select elements
        sendingKeySelect.onchange = async () => await this.saveConfig();
        receivingKeysSelect.onchange = async () => await this.saveConfig();
    }

    async saveConfig() {
        const { sendingKeySelect, receivingKeysSelect } = this.getSelectElements();
        if (sendingKeySelect && receivingKeysSelect) {
            const selectedSendingKey = sendingKeySelect.value;
            const selectedReceivingKeys = Array.from(receivingKeysSelect.selectedOptions).map(option => option.value).sort();
            const config = {
                sendingKey: selectedSendingKey,
                receivingKeys: selectedReceivingKeys
            };
            this.plugin.settings.pgpConfig = config;
            await this.plugin.saveData(this.plugin.settings);
            console.log('Config saved:', config);
        }
    }

    async loadKeys() {
        try {
            if (this.plugin.settings.pgpPrivatePath && this.plugin.settings.pgpPublicPath) {
                const privateFile = await this.app.vault.adapter.read(this.plugin.settings.pgpPrivatePath);
                const publicFile = await this.app.vault.adapter.read(this.plugin.settings.pgpPublicPath);
                const privateKey = await openpgp.decryptKey({
                    privateKey: await openpgp.readPrivateKey({ armoredKey: privateFile }),
                    passphrase: this.plugin.settings.privateKeyPassPhrase
                });
                const publicKey = await openpgp.readKey({ armoredKey: publicFile });
                this.privateKey = privateKey;
                this.publicKey = publicKey;
                new Notice('PGP keys loaded successfully.');
            } else {
                new Notice('PGP keys not configured in settings.');
            }
        } catch (error) {
            new Notice('Error loading PGP keys. Please check your file paths.');
            console.error(`Error loading PGP keys. Please check your file paths...\n${error}`);
        }
    }

    async getCombinedArmoredKey(keys: openpgp.Key[], isPrivate: boolean) {
        // Create a packet list to combine all key packets, user ID packets, and subkey packets
        const combinedPackets = new openpgp.PacketList<openpgp.AnyPacket>();
        
        // Sort keys by Key ID (you can sort by other criteria if needed, such as creation date)
        const sortedExistingKeys = keys.sort((a, b) => {
            const aKeyID = a.getKeyID().toHex();
            const bKeyID = b.getKeyID().toHex();
            return aKeyID.localeCompare(bKeyID);
        });

        for (const key of sortedExistingKeys) {
            // Extract primary key packet
            const primaryKeyPacket = key.keyPacket;

            // Extract subkey packets, including signatures
            const subkeyPackets = key.subkeys.map(subkey => {
                const packets: (openpgp.SecretSubkeyPacket | openpgp.PublicSubkeyPacket | openpgp.SignaturePacket)[] = [subkey.keyPacket];
                if (subkey.bindingSignatures) {
                    packets.push(...subkey.bindingSignatures);
                }
                return packets;
            }).flat(); // Flatten the array of subkey packets

            // Extract user ID and user attribute packets
            const userPackets = key.users.flatMap(user => {
                const packets = [];
                if (user.userID) {
                    packets.push(user.userID);
                }
                if (user.userAttribute) {
                    packets.push(user.userAttribute);
                }
                return packets;
            });

            // Extract signatures and certifications (self-signatures, etc.)
            const signaturePackets = key.users.flatMap(user => user.selfCertifications.concat(user.otherCertifications));

            // Add primary key, subkeys, user packets, and signatures to the combined packet list
            combinedPackets.push(primaryKeyPacket);
            combinedPackets.push(...subkeyPackets); // Add subkeys and their signatures
            combinedPackets.push(...userPackets);
            combinedPackets.push(...signaturePackets);
        }

        // Write the combined packets to a Uint8Array
        const combinedKeyBytes = combinedPackets.write();

        // Convert Uint8Array to an armored key block
        const armoredCombinedKey = openpgp.armor(isPrivate ? openpgp.enums.armor.privateKey : openpgp.enums.armor.publicKey, combinedKeyBytes);
        return armoredCombinedKey;
    }

    async importKey(armoredKey: string) {
        try {
            // Read the existing keys from file
            const existingKeysData = await this.app.vault.adapter.read(this.plugin.settings.allKeysPathSetting);
            const existingKeys = await openpgp.readKeys({ armoredKeys: existingKeysData.trim() });

            // Log the existing keys' KeyIDs
            //existingKeys.forEach((key, index) => {
            //    console.log(`Existing Key ${index + 1} ID: ${key.getKeyID().toHex()}`);
            //});

            // Validate and parse the new key
            const importedKey = await openpgp.readKey({ armoredKey: armoredKey.trim() });
            //console.log(`New Key ID: ${importedKey.getKeyID().toHex()}`);

            // Check for duplicates by comparing Key IDs
            const importedKeyID = importedKey.getKeyID().toHex();
            const keyExists = existingKeys.some(key => key.getKeyID().toHex() === importedKeyID);

            if (keyExists) {
                console.log(`Key with ID ${importedKeyID} already exists.`);
                new Notice(`❌ Key already exists!`);
                return; // Exit the function without adding the duplicate key
            }

            // Combine the new key with the existing ones
            existingKeys.push(importedKey);
            const armoredCombinedKey = await this.getCombinedArmoredKey(existingKeys, false);

            // Log the final combined key block
            //console.log(`Combined Armored Key Block:\n${armoredCombinedKey}`);

            // Save the updated combined key block back to the file
            await this.app.vault.adapter.write(this.plugin.settings.allKeysPathSetting, armoredCombinedKey);
            await this.loadAndDisplayKeys();
        } catch (error) {
            console.error('Error importing key:', error);
        }
    }

    async importPrivateKey(armoredKey: string) {
        try {
            // Read the existing keys from file
            const existingKeysData = await this.app.vault.adapter.read(this.plugin.settings.allPrivateKeysPathSetting);
            const existingKeys = await openpgp.readPrivateKeys({ armoredKeys: existingKeysData.trim() });

            // Log the existing keys' KeyIDs
            //existingKeys.forEach((key, index) => {
            //    console.log(`Existing Key ${index + 1} ID: ${key.getKeyID().toHex()}`);
            //});

            // Validate and parse the new key
            const importedKey = await openpgp.readPrivateKey({ armoredKey: armoredKey.trim() });
            //console.log(`New Key ID: ${importedKey.getKeyID().toHex()}`);

            // Check for duplicates by comparing Key IDs
            const importedKeyID = importedKey.getKeyID().toHex();
            const keyExists = existingKeys.some(key => key.getKeyID().toHex() === importedKeyID);

            if (keyExists) {
                console.log(`Key with ID ${importedKeyID} already exists.`);
                new Notice(`❌ Key already exists!`);
                return; // Exit the function without adding the duplicate key
            }

            // Combine the new key with the existing ones
            existingKeys.push(importedKey);

            // Create a packet list to combine all key packets, user ID packets, and subkey packets
            const combinedPackets = new openpgp.PacketList<openpgp.AnyPacket>();
            
            // Sort keys by Key ID (you can sort by other criteria if needed, such as creation date)
            const sortedExistingKeys = existingKeys.sort((a, b) => {
                const aKeyID = a.getKeyID().toHex();
                const bKeyID = b.getKeyID().toHex();
                return aKeyID.localeCompare(bKeyID);
            });

            for (const key of sortedExistingKeys) {
                // Extract primary key packet
                const primaryKeyPacket = key.keyPacket;

                // Extract subkey packets, including signatures
                const subkeyPackets = key.subkeys.map(subkey => {
                    const packets: (openpgp.SecretSubkeyPacket | openpgp.PublicSubkeyPacket | openpgp.SignaturePacket)[] = [subkey.keyPacket];
                    if (subkey.bindingSignatures) {
                        packets.push(...subkey.bindingSignatures);
                    }
                    return packets;
                }).flat(); // Flatten the array of subkey packets

                // Extract user ID and user attribute packets
                const userPackets = key.users.flatMap(user => {
                    const packets = [];
                    if (user.userID) {
                        packets.push(user.userID);
                    }
                    if (user.userAttribute) {
                        packets.push(user.userAttribute);
                    }
                    return packets;
                });

                // Extract signatures and certifications (self-signatures, etc.)
                const signaturePackets = key.users.flatMap(user => user.selfCertifications.concat(user.otherCertifications));

                // Add primary key, subkeys, user packets, and signatures to the combined packet list
                combinedPackets.push(primaryKeyPacket);
                combinedPackets.push(...subkeyPackets); // Add subkeys and their signatures
                combinedPackets.push(...userPackets);
                combinedPackets.push(...signaturePackets);
            }

            // Write the combined packets to a Uint8Array
            const combinedKeyBytes = combinedPackets.write();

            // Convert Uint8Array to an armored key block
            const armoredCombinedKey = openpgp.armor(openpgp.enums.armor.privateKey, combinedKeyBytes);

            // Log the final combined key block
            //console.log(`Combined Armored Key Block:\n${armoredCombinedKey}`);

            // Save the updated combined key block back to the file
            await this.app.vault.adapter.write(this.plugin.settings.allPrivateKeysPathSetting, armoredCombinedKey);
            await this.loadAndDisplayKeys();
        } catch (error) {
            console.error('Error importing private key:', error);
        }
    }
 
    async encryptText(text: string): Promise<string> {
        const currentSelections: openpgp.PublicKey[] = [];
        let privateKeySelection: openpgp.PrivateKey = this.privateKey;
        const { receivingKeysSelect, sendingKeySelect } = this.getSelectElements();
        const { publicKeys, privateKeys } = await this.getPGPKeys(); // Fetch all available keys
        // Loop through the selected receiving keys
        for (const option of this.plugin.settings.pgpConfig.receivingKeys) {
            try {
                const selectedOption = receivingKeysSelect.options[Number(option)]?.text;
                if (selectedOption) {
                    // Find the key matching the selected user ID
                    const matchedKey = publicKeys.find(key => key.getUserIDs().includes(selectedOption));
                    if (matchedKey) {
                        // Fetch the encryption key for this user
                        const encryptionKey = await matchedKey.getEncryptionKey();
                        if (encryptionKey) {
                            currentSelections.push(
                                (encryptionKey as openpgp.Subkey)?.mainKey
                                    ? (encryptionKey as openpgp.Subkey).mainKey
                                    : ( (encryptionKey as openpgp.Key).toPublic() ?? encryptionKey) as openpgp.Key
                                );
                        } else {
                            console.error(`No encryption key found for ${selectedOption}`);
                        }
                    } else {
                        console.error(`No matching key found for user ID ${selectedOption}`);
                    }
                }
            } catch (err) {
                console.error(`Error retrieving public encryption keys:\n${err}`);
            }
        }

        try {
            const selectedIndex = sendingKeySelect.selectedIndex; // Use selected index to get the currently selected option
            const selectedOption = sendingKeySelect.options.item(selectedIndex)?.text;

            for (const key of privateKeys) {
                const primaryUser = await key.getPrimaryUser();
                const userID = primaryUser.user.userID?.userID;
                // Check if the user ID matches the selected option
                if (userID === selectedOption) {
                    privateKeySelection = key as openpgp.PrivateKey;
                    break; // Break the loop once the key is found
                }
            }
            if (!privateKeySelection) {
                console.error(`No matching key found for user ID ${selectedOption}`);
            }
        } catch (err) {
            console.error(`Error retrieving private encryption key:\n${err}`);
        }
        if (currentSelections.length === 0) currentSelections.push(this.publicKey);
        try {
            const signKeys = await this.decryptPrivateKeys(Array.isArray(privateKeySelection) ? privateKeySelection : [privateKeySelection]);
            const message = await openpgp.createMessage({ text: text });

            //const signingKey = await privateKeySelection.getSigningKey(
            //    privateKeySelection.getKeyID(), null,
            //    (await privateKeySelection.getPrimaryUser()).user.userID?.userID as openpgp.UserID
            //);
            //if (!signingKey) {
            //    console.error('Selected private key does not support signing.');
            //    return 'Private key does not support signing.';
            //} // else console.log(`SIGNING KEY: ${Object.entries((signingKey as any).subkeys[0])}`);

            const encrypted = await openpgp.encrypt({
                message: message,
                encryptionKeys: currentSelections,
                signingKeys: this.plugin.settings.signMessage ? signKeys : undefined,
                format: 'armored'
            })

            return encrypted;  // Return the encrypted message
        } catch (err) {
            console.error(`Error with message creation or encryption:\n${err}\n${err?.name}\n${err?.stack}`);
            return `Error with message creation or encryption...\n${err}`;
        }
    }

    async decryptText(encryptedText: string, privateKeys: openpgp.PrivateKey[] | openpgp.PrivateKey, passPhrase?: string): Promise<string> {
        try {
            const decryptedPrivateKeys = await this.decryptPrivateKeys(privateKeys, passPhrase);
            const message = await openpgp.readMessage({
                armoredMessage: encryptedText // parse armored message
            });
            const { data: decrypted, signatures } = await openpgp.decrypt({
                message,
                verificationKeys: this.plugin.settings.verifyMessage  // optional
                    ? (await this.getPGPKeys()).publicKeys
                    : undefined,
                decryptionKeys: decryptedPrivateKeys,
            });
            
            if (this.plugin.settings.verifyMessage) {
                // Log the signatures and check if they were verified
                for (const signature of signatures) {
                    const { keyID, verified } = signature;
                    const isVerified = await verified;
                    // Check if the signature was successfully verified
                    if (isVerified) {
                        console.log(`Signature from keyID ${keyID.toHex()} was successfully verified.`);
                    } else {
                        console.error(`Signature verification failed for keyID ${keyID.toHex()}.`);
                    }
                }
            }
            return decrypted;
        } catch (error) {
            if (error.message === `Error decrypting message: Session key decryption failed.`) {
                new Notice(`🚨 You are attempting to decrypt a message that was not encrypted for your key!`);
                return 'Incorrect decryption key.';
            } else if (error.message.includes('Incorrect key passphrase')) {
                // If passphrase is incorrect, open modal and retry decryption with the new passphrase
                if (!passPhrase) {  // This ensures the modal opens only the first time an incorrect passphrase is detected
                    new PGPPasswordModal(this.app, async (newPassphrase: string) => {
                        const decryptedValue = await this.decryptText(encryptedText, privateKeys, newPassphrase); // Retry with new passphrase
                        const outputArea = this.contentEl.querySelector('#output-area') as HTMLTextAreaElement;
                        outputArea.value = decryptedValue;
                        navigator.clipboard.writeText(decryptedValue);
                        new Notice('✅ Encrypted Message Copied to Clipboard.');
                    }, () => {
                        new Notice('Decryption cancelled.');
                    }).open();
                } else {
                    new Notice('Incorrect passphrase provided.');
                }
                return ''; // Return early since we're awaiting user input
            } else {
                new Notice('Error decrypting text.');
                console.error(`${error}\n${error?.name}\n${error?.stack}\n${error?.stack}`);
                return `Error during decryption...\n${error}`;
            }
        }
    }

    async decryptPrivateKeys(privateKeys: openpgp.PrivateKey[] | openpgp.PrivateKey, passphrase?: string): Promise<openpgp.PrivateKey[]> {
        const decryptedPrivateKeys: openpgp.PrivateKey[] = [];
        if (Array.isArray(privateKeys)) {
            console.log(`ARRAY`)
            for (const key of privateKeys) {
                decryptedPrivateKeys.push(
                    await openpgp.decryptKey({
                        privateKey: key,
                        passphrase: this.plugin.settings.privateKeyPassPhrase
                    })
                )
            }
        } else {
            console.log(`PRIVATE KEY NON ARRAY`)
            decryptedPrivateKeys.push(
                await openpgp.decryptKey({
                    privateKey: privateKeys,
                    passphrase: passphrase ?? this.plugin.settings.privateKeyPassPhrase
                })
            )
        }
        return decryptedPrivateKeys;
    }
}

export class PGPImporter extends Modal {
    app: App;
    plugin: ProjectsHTMLInjector;
    pgpTool: PGPTool;
    publicKeyImportCallback: PGPTool["importKey"];
    privateKeyImportCallback: PGPTool["importPrivateKey"];
    progressBar: ProgressBarComponent;
    settings: HTMLInjectSettings;

    constructor(app: App, plugin: ProjectsHTMLInjector, publicKeyImportCallback: (armoredKey: string) => Promise<void>, privateKeyImportCallback: (armoredKey: string) => Promise<void>) {
        super(app);
        this.publicKeyImportCallback = publicKeyImportCallback;
        this.privateKeyImportCallback = privateKeyImportCallback;
        this.plugin = plugin;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        this.contentEl = contentEl;
        this.contentEl.empty();
        this.modalEl.setCssStyles({
            'width': '1600px',
            'resize': 'both'
        });

        this.contentEl.createEl('h1', { text: 'Import PGP Key' });

        const inputContainer = this.contentEl.createEl('div');
        inputContainer.setCssStyles({
            'display': 'flex',
            'gap': '20px',
            'width': '100%',
        });
        
        const publicContainer = this.contentEl.createEl('div');
        publicContainer.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'width': '47.5%',
        });
        const publicInputHeader = this.contentEl.createEl('h2', { text: 'Public Key' });
        const publicInputArea = this.contentEl.createEl('textarea');
        publicInputArea.setCssStyles({
            'width': '100%',
            'height': '400px',
            'resize': 'none'
        });
        const privateContainer = this.contentEl.createEl('div');
        privateContainer.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'width': '47.5%',
        });
        const privateInputHeader = this.contentEl.createEl('h2', { text: 'Private Key' });
        const privateInputArea = this.contentEl.createEl('textarea');
        privateInputArea.setCssStyles({
            'width': '100%',
            'height': '400px',
            'resize': 'none'
        });
        const importBtn = this.contentEl.createEl('button', { text: 'Import' });
        const cancelBtn = this.contentEl.createEl('button', { text: 'Cancel' });

        const btnContainer = this.contentEl.createEl('div');
        btnContainer.setCssStyles({
            'display': 'flex',
            'marginTop': '15px',
            'justifyContent': 'center',
        });

        publicContainer.append(publicInputHeader, publicInputArea);
        privateContainer.append(privateInputHeader, privateInputArea);
        inputContainer.append(publicContainer, privateContainer);
        btnContainer.append(importBtn, cancelBtn);

        importBtn.onclick = async () => {
            const publicKey = publicInputArea.value.trim();
            const privateKey = privateInputArea.value.trim();
            if (isPgp(publicKey)) {
                await this.publicKeyImportCallback.bind(this)(publicKey);  // Bind this here to retain context;
            }
            if (isPgp(privateKey)) {
                await this.privateKeyImportCallback.bind(this)(privateKey);  // Bind this here to retain context;
            }
            this.close();
        }
        cancelBtn.onclick = () => {
            this.contentEl.empty();
            this.close();
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class CreateKeyModal extends Modal {
    private name: string = "";
    private email: string = "";
    private password: string = "";
    private comment: string = "";
    private keyType: openpgp.GenerateKeyOptions["type"] = 'rsa';
    private rsaBits: number = 4096;
    private expiryDate: string = moment().add(4, 'years').format('YYYY-MM-DD');
    private dateInput: HTMLInputElement;
    private progressBar: ProgressBarComponent;
    private matchingPasswords: boolean = false;
    public parent: PGPTool;

    constructor(app: App, parent: PGPTool) {
        super(app);
        this.parent = parent;
    }

    onOpen() {
        let {contentEl} = this;

        contentEl.createEl('h2', {text: 'Create new key pair'});

        new Setting(contentEl)
            .setName('Name')
            .addText(text => text
                .setPlaceholder('Enter your name')
                .onChange(value => this.name = value));

        new Setting(contentEl)
            .setName('Email')
            .addText(text => text
                .setPlaceholder('Enter your email')
                .onChange(value => this.email = value));

        const bar = new Setting(contentEl)
            .setName('Password')
            .addText(text => {
                text
                .setPlaceholder('Password')
                .onChange(value => {
                    this.password = value;
                    new PasswordStrengthTool(this.app, this.password, this.progressBar);
                })
                .inputEl.id = 'first-input'
            })
            .setDesc(`❌ Passwords Do Not Match! ❌`)
            .addText(text => {
                text
                .setPlaceholder('Re-Type Password')
                .onChange(value => {
                    const passwordsMatch = this.password === value;
                    if (passwordsMatch) {
                        this.matchingPasswords = true;
                        bar.setDesc(`✅ Passwords Match! ✅`);
                    } else {
                        this.matchingPasswords = false;
                        bar.setDesc(`❌ Passwords Do Not Match! ❌`);
                    }
                })
                .inputEl.id = 'second-input'
            })
            .addButton(btn => {
                btn.buttonEl.textContent = btn.buttonEl.textContent !== 'Hide' ? 'View' : 'Hide';
                btn.buttonEl.id = 'view-password-btn';
                btn.onClick((event: MouseEvent) => {
                    const textInput = (bar.controlEl.querySelector('#first-input') as HTMLInputElement);
                    if (textInput.type !== 'text') {
                        textInput.type = 'text';
                        btn.buttonEl.textContent = 'Hide';
                    } else {
                        textInput.type = 'password'
                        btn.buttonEl.textContent = 'View';
                    }
                })
            })
            .addButton(btn => {
                btn.buttonEl.textContent = btn.buttonEl.textContent !== 'Hide' ? 'View' : 'Hide';
                btn.buttonEl.id = 'view-password-btn-two';
                btn.onClick((event: MouseEvent) => {
                    const textInput = (bar.controlEl.querySelector('#second-input') as HTMLInputElement);
                    if (textInput.type !== 'text') {
                        textInput.type = 'text';
                        btn.buttonEl.textContent = 'Hide';
                    } else {
                        textInput.type = 'password'
                        btn.buttonEl.textContent = 'View';
                    }
                })
            })
            .addProgressBar(bar => {
                this.progressBar = bar;
                bar.setValue(0);
            })
        const barControlEl = bar.controlEl;
        barControlEl.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'width': 'max-content'
        });
        const barInfoEl = bar.infoEl;
        const pBar = barControlEl.querySelector(".setting-progress-bar") as HTMLElement;
        const mainPasswordSettingContainer = contentEl.createEl('div');
        mainPasswordSettingContainer.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column',
            'alignItems': 'left'
        });
        const firstInputAndBtn = contentEl.createEl('div', { attr: { id: 'input-btn-div' } });
        firstInputAndBtn.setCssStyles({
            'display': 'flex'
        });
        const secondInputAndBtn = contentEl.createEl('div', { attr: { id: 'input-btn-div' } });
        secondInputAndBtn.setCssStyles({
            'display': 'flex'
        });
        const barInputElOne = barControlEl.querySelector('#first-input') as HTMLInputElement;
        const barInputElTwo = barControlEl.querySelector('#second-input') as HTMLInputElement;
        barInputElOne.type = 'password';
        barInputElTwo.type = 'password';
        const barViewBtnOne = barControlEl.querySelector('#view-password-btn') as HTMLButtonElement;
        const barViewBtnTwo = barControlEl.querySelector('#view-password-btn-two') as HTMLButtonElement;
        firstInputAndBtn.append(barInputElOne, barViewBtnOne);
        secondInputAndBtn.append(barInputElTwo, barViewBtnTwo);
        mainPasswordSettingContainer.append(firstInputAndBtn, secondInputAndBtn);
        barInfoEl.appendChild(pBar);
        barControlEl.appendChild(mainPasswordSettingContainer);

        new Setting(contentEl)
            .setName('Comment')
            .addText(text => text
                .setPlaceholder('Comment (optional)')
                .onChange(value => this.comment = value)
            );

        new Setting(contentEl)
            .setName('Key Type')
            .addDropdown(drop => drop
                .addOption('rsa', 'RSA and RSA (default)')
                .addOption('ecc', 'DSA and Elgamal')
                .setValue('rsa')
                .onChange(value => this.keyType = value as openpgp.GenerateKeyOptions['type'])
            );

        new Setting(contentEl)
            .setName('Length')
            .addDropdown(drop => drop
                .addOption('2048', '2048')
                .addOption('4096', '4096')
                .setValue('4096')
                .onChange(value => this.rsaBits = parseInt(value))
            );

        new Setting(contentEl)
            .setName('Key will expire on')
            .addMomentFormat(date => {
                date.setDefaultFormat('YYYY-MM-DD'); // Make sure this matches the expected date format
                date.setValue(this.expiryDate); // Set the default value
                date.onChange((value) => this.expiryDate = value);
                date.inputEl.type = 'date'; // Set the input type
            });

        // Add Create and Cancel buttons
        const buttonContainer = contentEl.createDiv({cls: 'button-container'});
        buttonContainer.createEl('button', {text: 'Create Key'}, (btn) => {
            btn.addClass('mod-cta');
            btn.onclick = async () => {
                const { publicKey, privateKey } = await this.createKey(this, this.parent);
                await this.parent.importPrivateKey(privateKey);
                await this.parent.importKey(publicKey);
            }
        });
        buttonContainer.createEl('button', {text: 'Cancel'}, (btn) => {
            btn.onclick = () => this.close();
        });
    }

    onClose() {
        let {contentEl} = this;
        contentEl.empty();
    } 

    async createKey(parent: CreateKeyModal, grandParent: PGPTool) {
        // Logic to create the key with the provided details
        const { publicKey, privateKey } = await openpgp.generateKey({
            'userIDs': { name: this.name, email: this.email, comment: this.comment },
            'rsaBits': this.rsaBits,
            'passphrase': this.password,
            'type': this.keyType,
            'keyExpirationTime': Math.round(moment(this.expiryDate).clone().diff(moment(), 'seconds', true)),
            'format': 'armored',
        });
        console.log(`CONFIG: ${await openpgp.readPrivateKey({ armoredKey: privateKey })}`);

        this.close();
        new Notice('Key Created Successfully'); // TODO:
        //if (parent.matchingPasswords) await grandParent.importKey(publicKey)
        if (parent.matchingPasswords) return { publicKey, privateKey };
        throw new Error(`Keys not generated...\n\n${publicKey}\n\n${privateKey}`);
    }
}

class PGPPasswordModal extends Modal {
    private onSubmit: (passphrase: string) => void;
    private onCancel: () => void;
    private passphrase: string = '';

    constructor(app: App, onSubmit: (passphrase: string) => void, onCancel: () => void) {
        super(app);
        this.onSubmit = onSubmit;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h2', { text: 'Enter Passphrase' });

        const passphraseInput = contentEl.createEl('input', {
            type: 'password',
            placeholder: 'Enter your PGP key passphrase...',
        });
        passphraseInput.setCssStyles({
            'width': '100%'
        })

        passphraseInput.oninput = (e: Event) => {
            const input = e.target as HTMLInputElement;
            this.passphrase = input.value;
            console.log(this.passphrase);
        };

        const submitButton = contentEl.createEl('button', { text: 'Submit' });
        submitButton.onclick = () => {
            this.onSubmit(this.passphrase);
            this.close();
        };

        const cancelButton = contentEl.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.onCancel();
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class PasswordStrengthTool {
    app: App; // Assuming there's some broader application context
    passwordComponent: string;
    progressBar: ProgressBarComponent;

    constructor(app: App, valueComponent: string, progressBar: ProgressBarComponent) {
        this.app = app;
        this.passwordComponent = valueComponent;
        this.progressBar = progressBar;
        this.handlePassword(valueComponent);
    }

    handlePassword(password: string) {
        let power = document.querySelector(".setting-progress-bar-inner") as HTMLElement;
        let point = 0;
        let widthPower = ["1%", "25%", "50%", "75%", "100%"];
        let colorPower = ["#D73F40", "#DC6551", "#F2B84F", "#BDE952", "#3ba62f"];
        const newPassword = password;
        console.log(newPassword)

        if (newPassword.length >= 5) {
            let arrayTest = [/[0-9]/, /[a-z]/, /[A-Z]/, /[^0-9a-zA-Z]/];
            arrayTest.forEach((item) => {
                if (item.test(newPassword)) {
                    point += 1;
                }
            });
            if (newPassword.length >= 10 && point === 4) point += 1;
        } else if (newPassword.length > 0) {
            point += 1;
        }
        this.progressBar.setValue(point !== 5 ? point / 5 % 100 : 100);
        power.style.width = widthPower[point !== 0 ? point - 1 : point];
        power.style.backgroundColor = colorPower[point !== 0 ? point - 1 : point];
    }
}
