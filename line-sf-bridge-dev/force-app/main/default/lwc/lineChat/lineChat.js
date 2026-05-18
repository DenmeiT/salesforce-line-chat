import { LightningElement, api, wire } from 'lwc';
import getMessages from '@salesforce/apex/LineChatController.getMessages';
import getConversations from '@salesforce/apex/LineChatController.getConversations';
import sendReply from '@salesforce/apex/LineChatController.sendReply';
import { refreshApex } from '@salesforce/apex';

export default class LineChat extends LightningElement {
    @api recordId;

    replyText = '';
    messages = [];
    conversations = [];

    wiredMessagesResult;
    wiredConversationResult;

    refreshTimer;
    refreshKey = String(Date.now());

    sendOnEnter = true;
    isSending = false;
    lastMessageCount = 0;

    selectedConversationId;

    @wire(getConversations, {
        refreshKey: '$refreshKey'
    })
    wiredConversations(result) {
        this.wiredConversationResult = result;

        if (result.data) {
            this.conversations = result.data.map((conv) => {
                return {
                    ...conv,
                    cssClass:
                        conv.Id === this.selectedConversationId
                            ? 'conversation-item selected'
                            : 'conversation-item'
                };
            });
    });

        if (!this.selectedConversationId && result.data.length > 0) {
            this.selectedConversationId = result.data[0].Id;
            }
        } else if (result.error) {
            console.error(result.error);
        }
    }

    @wire(getMessages, {
        conversationId: '$selectedConversationId',
        refreshKey: '$refreshKey'
    })
    wiredMessages(result) {
        this.wiredMessagesResult = result;

        if (result.data) {
            const newMessages = result.data.map((msg) => {
                return {
                    ...msg,
                    formattedTime: new Date(msg.SentAt__c).toLocaleString('ja-JP'),
                    cssClass:
                        msg.Direction__c === 'Outbound'
                            ? 'message-row outbound'
                            : 'message-row inbound'
                };
            });

            const hasNewMessage =
                newMessages.length > this.lastMessageCount;

            this.messages = newMessages;

            if (hasNewMessage) {
                this.scrollToBottom();
            }

            this.lastMessageCount = newMessages.length;

        } else if (result.error) {
            console.error(result.error);
        }
    }

    connectedCallback() {
        this.selectedConversationId = this.recordId;

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

    handleConversationClick(event) {
        this.selectedConversationId =
            event.currentTarget.dataset.id;

        this.lastMessageCount = 0;
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
                conversationId: this.selectedConversationId,
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
            const messageArea =
                this.template.querySelector('.message-area');

            if (messageArea) {
                messageArea.scrollTop =
                    messageArea.scrollHeight;
            }
        }, 100);
    }
}