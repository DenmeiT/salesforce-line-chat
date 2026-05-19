public with sharing class LineChatController {

    @AuraEnabled(cacheable=true)
    public static List<LINE_Message__c> getMessages(Id conversationId, String refreshKey) {
        return [
            SELECT Id,
                   Name,
                   Direction__c,
                   MessageText__c,
                   MessageType__c,
                   SentAt__c,
                   CreatedDate
            FROM LINE_Message__c
            WHERE Conversation__c = :conversationId
            ORDER BY SentAt__c ASC, CreatedDate ASC
            LIMIT 200
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<LINE_Conversation__c> getConversations(String refreshKey) {
        return [
            SELECT Id,
                   Name,
                   Contact__c,
                   Contact__r.Name,
                   Contact__r.LINEDisplayName__c,
                   Contact__r.LINEPictureUrl__c,
                   Status__c,
                   LastMessageAt__c,
                   LastMessageText__c,
                   CreatedDate
            FROM LINE_Conversation__c
            ORDER BY LastMessageAt__c DESC NULLS LAST, CreatedDate DESC
            LIMIT 100
        ];
    }

    @AuraEnabled
    public static String sendReply(Id conversationId, String text) {
        if (conversationId == null) {
            throw new AuraHandledException('conversationId が空です。');
        }
        if (String.isBlank(text)) {
            throw new AuraHandledException('返信本文が空です。');
        }

        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://line-sf-bridge-dev-382d57e13f70.herokuapp.com/send-from-salesforce');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');

        Map<String, Object> body = new Map<String, Object>{
            'conversationId' => String.valueOf(conversationId),
            'text' => text
        };

        req.setBody(JSON.serialize(body));

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw new AuraHandledException('LINE送信に失敗しました: ' + res.getBody());
        }

        return res.getBody();
    }
}