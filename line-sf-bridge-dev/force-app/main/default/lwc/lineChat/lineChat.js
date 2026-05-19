import { LightningElement, api, wire } from 'lwc';
import getMessages from '@salesforce/apex/LineChatController.getMessages';
import getConversations from '@salesforce/apex/LineChatController.getConversations';
import sendReply from '@salesforce/apex/LineChatController.sendReply';
import { refreshApex } from '@salesforce/apex';
import markAsRead from '@salesforce/apex/LineChatController.markAsRead';

export default class LineChat extends LightningElement {
    @api recordId;

    replyText = '';
    messages = [];
    conversations = [];

    searchKeyword = '';
    allConversations = []; 

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

            this.allConversations = result.data.map((conv) => {
                return {
                    ...conv,

                    isUnread: conv.IsUnread__c === true,
                    isWaitingReply: conv.IsWaitingReply__c === true,

                    displayName:
                        conv.Contact__r && conv.Contact__r.LINEDisplayName__c
                            ? conv.Contact__r.LINEDisplayName__c
                            : conv.Contact__r && conv.Contact__r.Name
                                ? conv.Contact__r.Name
                                : 'LINEユーザー',

                    pictureUrl:
                        conv.Contact__r && conv.Contact__r.LINEPictureUrl__c
                            ? conv.Contact__r.LINEPictureUrl__c
                            : '',

                    latestMessagePreview: conv.LastMessageText__c || '',

                    formattedLastMessageAt: conv.LastMessageAt__c
                        ? new Date(conv.LastMessageAt__c).toLocaleString('ja-JP', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                        : '',

                    cssClass:
                        conv.Id === this.selectedConversationId
                            ? 'conversation-item selected'
                            : 'conversation-item'
                };
            });

            this.applyConversationFilter();

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

                    formattedTime: msg.SentAt__c
                        ? new Date(msg.SentAt__c).toLocaleString(
                            'ja-JP',
                            {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            }
                        )
                        : '',

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

    get unreadCount() {
        return this.conversations.filter((conv) => conv.isUnread).length;
    }

    get cardTitle() {
        if (this.unreadCount > 0) {
            return `LINEチャット（未読 ${this.unreadCount}）`;
        }

        return 'LINEチャット';
    }

    get sendModeHelpText() {
        if (this.sendOnEnter) {
            return 'Enterで送信 / Shift+Enterで改行';
        }

        return 'Enterで改行 / Shift+Enterで送信';
    }

    async handleConversationClick(event) {
        const conversationId =
            event.currentTarget.dataset.id;

        this.selectedConversationId = conversationId;

        this.lastMessageCount = 0;

        try {
            await markAsRead({
                conversationId: conversationId
            });

            this.refreshKey = String(Date.now());

        } catch (error) {
            console.error(error);
        }
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

    handleSearchChange(event) {
        this.searchKeyword = event.target.value || '';
        this.applyConversationFilter();
    }

    applyConversationFilter() {
        const keyword = (this.searchKeyword || '').toLowerCase();

        if (!keyword) {
            this.conversations = this.allConversations;
            return;
        }

        this.conversations = this.allConversations.filter((conv) => {
            const name = (conv.displayName || '').toLowerCase();
            const message = (conv.latestMessagePreview || '').toLowerCase();

            return name.includes(keyword) || message.includes(keyword);
         });
    }

}