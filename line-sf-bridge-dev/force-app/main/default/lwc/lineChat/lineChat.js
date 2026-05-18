import { LightningElement, api, wire } from 'lwc';
import getMessages from '@salesforce/apex/LineChatController.getMessages';
import sendReply from '@salesforce/apex/LineChatController.sendReply';
import { refreshApex } from '@salesforce/apex';

export default class LineChat extends LightningElement {
    @api recordId;

    replyText = '';
    messages = [];
    wiredMessagesResult;
    refreshTimer;
    refreshKey = String(Date.now());
    sendOnEnter = true;
    isSending = false;

    @wire(getMessages, {
        conversationId: '$recordId',
        refreshKey: '$refreshKey'
    })
    wiredMessages(result) {
        this.wiredMessagesResult = result;

        if (result.data) {
            this.messages = result.data.map((msg) => {
                return {
                    ...msg,
                    cssClass:
                        msg.Direction__c === 'Outbound'
                            ? 'message-row outbound'
                            : 'message-row inbound'
                };
            });

            this.scrollToBottom();
        } else if (result.error) {
            console.error(result.error);
        }
    }

    connectedCallback() {
        this.refreshTimer = setInterval(() => {
            this.refreshKey = String(Date.now());
        }, 3000);
    }

    disconnectedCallback() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
    }

    get sendModeHelpText() {
        if (this.sendOnEnter) {
            return 'Enterで送信 / Shift+Enterで改行';
        }
        return 'Enterで改行 / Shift+Enterで送信';
    }

    handleSendModeChange(event) {
        this.sendOnEnter = event.target.checked;
    }

    handleChange(event) {
        this.replyText = event.target.value;
    }

    handleKeyDown(event) {
        if (event.key !== 'Enter') {
            return;
        }

        const shouldSend =
            (this.sendOnEnter && !event.shiftKey) ||
            (!this.sendOnEnter && event.shiftKey);

        if (shouldSend) {
            event.preventDefault();
            this.sendMessage();
        }
    }

    async sendMessage() {
        const text = (this.replyText || '').trim();

        if (!text || this.isSending) {
            return;
        }

        this.isSending = true;

        try {
            await sendReply({
                conversationId: this.recordId,
                text
            });

            this.replyText = '';
            this.refreshKey = String(Date.now());
            await refreshApex(this.wiredMessagesResult);
            this.scrollToBottom();
        } catch (error) {
            console.error(error);
        } finally {
            this.isSending = false;
        }
    }

    scrollToBottom() {
        window.setTimeout(() => {
            const messageArea = this.template.querySelector('.message-area');
            if (messageArea) {
                messageArea.scrollTop = messageArea.scrollHeight;
            }
        }, 100);
    }
}