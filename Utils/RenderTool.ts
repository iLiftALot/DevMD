import { loadPrism } from 'obsidian';
import { marked, Token, Tokens } from 'marked';
import ProjectsHTMLInjector, { generateCheckboxKey } from '../main';


export async function renderMarkdown(markdown: string, plugin: ProjectsHTMLInjector): Promise<string> {
	const Prism = await loadPrism();
	const renderer = {
		// Handle fenced code blocks
		code: ({ text, lang, escaped }: Tokens.Code): string => {
			const language = lang && Prism.languages[lang] ? lang : 'plaintext';
			const highlightedCode = Prism.highlight(text, Prism.languages[language], language);
			// Create code container
			const codeContainer = document.createElement('div');
			codeContainer.classList.add('code-container');

			const preElement = document.createElement('pre');
			preElement.classList.add(`language-${language}`, 'custom-pre');
			preElement.setAttribute('tabindex', '0');

			const codeElement = document.createElement('code');
			codeElement.classList.add(`language-${language}`, 'is-loaded', 'custom-loaded');
			codeElement.innerHTML = highlightedCode;

			const copyButton = document.createElement('button');
			copyButton.classList.add('copy-code-button', 'custom-copy-btn');
			copyButton.id = 'btn-custom-copy'
			copyButton.textContent = 'Copy';

			preElement.appendChild(codeElement);
			preElement.appendChild(copyButton);
			codeContainer.appendChild(preElement);

			return codeContainer.outerHTML;
		},
		listitem: (token: Tokens.ListItem): string => {
			const text = marked.parseInline(token.text);

			// Render list item by processing all its tokens
			const itemText = token.tokens ? token.tokens.map(tok => renderToken(tok)).join('') : token.text;

			// Use a unique key for each checkbox based on its text
			const checkboxKey = generateCheckboxKey(token.text);
			// Check if it's a task list item using the 'task' property
			if (token.task) {
				const allCheckBoxes = document.querySelectorAll(`input [data-key="-${checkboxKey}-${token.text.split('').join('-')}"]`);
				// Render a checkbox input based on whether it's checked
				const isChecked = plugin.settings.checkboxState[checkboxKey] || token.checked;
				const checkbox = `<input type="checkbox" data-key="${checkboxKey}" ${isChecked ? 'checked' : ''} onclick="updateCheckboxState(this)">`;
				const textWithStrike = `<span class="checkbox-text">${isChecked ? `<s>${text}</s>` : text}</span>`;
				// Handle cases where the list item contains unexpected content or newlines
				if (token.loose || /\n/.test(token.raw)) {
					return `<li style="list-style: none">${checkbox}${textWithStrike}</li>`;
				} else {
					return `<li style="list-style: none">${checkbox}${textWithStrike}</li>`;
				}
			} else {
				return `<li>${itemText}</li>`;
			}
		},
		link: (token: Tokens.Link): string => {
			const href = token.href ? `href="${token.href}"` : '';
			const title = token.title ? `title="${token.title}"` : '';
			return `<a ${href} ${title} class='internal-link'>${token.text}</a>`;
		},
	};

	// ISSUE WITH THIS
	/**
	 * Sanitize html to avoid  XSS attacks.
	 * @param html string containing the html
	 * @returns {string} Sanitized HTML
	 */
	//const postprocess = (html: string) => {
	//	return DOMPurify.sanitize(html);
	//}
	//marked.use({ renderer, hooks: { postprocess } }); // causing strikethrough to not occur
	marked.use({ renderer });
	try {
		return marked.parse(markdown);
	} catch (error) {
		console.error('Error parsing markdown:', error);
		return `<p style="color: red;">Error rendering markdown:</p><br><br>${error}`;
	}
}

// Helper function to render tokens recursively
function renderToken(token: Token): string {
	try {
		switch (token.type) {
			case 'text':
				return token.text;
			case 'link':
				const href = token.href ? `href="${token.href}"` : '';
				const title = token.title ? `title="${token.title}"` : '';
				return `<a ${href} ${title}>${token.text}</a>`;
			case 'list':
					const listType = token.ordered ? 'ol' : 'ul';
					return `<${listType}>${token.items.map(
						(tok: Token) => renderToken(tok)
					).join('')}</${listType}>`;
			case 'list_item':
				return `<li>${(token.tokens as any).map((tok: any) => renderToken(tok)).join('')}</li>`;
			case 'paragraph':
				return `<p>${(token.tokens as any).map((tok: any) => renderToken(tok)).join('')}</p>`;
			default:
				return token.raw || '';
		}
	} catch (err) {
		console.error(`Error rendering token of type ${token.type}:`, err);
		return `<p style="color: red;">Error rendering token</p>`;
	}
}
