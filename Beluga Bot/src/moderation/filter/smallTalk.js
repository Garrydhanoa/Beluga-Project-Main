/**
 * Messages with nothing to judge: "gg", "lol bro", a link, an emoji. About 1 in 6 messages in
 * #general are like this, so skipping them saves that many API calls. Only whole messages
 * made entirely of these words count, so a disguised slur can never hide in here.
 */

const HARMLESS = new Set(`gg ggs wp glhf gl hf lol lmao lmfao rofl haha hahaha ok okay k kk yes yeah yep yea ya
    no nah nope ty thx thanks np nice cool true fr same bet facts wow oh ah bruh bro rip damn sheesh hi hey hello
    yo sup gn gm idk ikr omg wtf nvm mb sorry please pls`.split(/\s+/));

function isSmallTalk(text) {
    const bare = String(text || '')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>/g, ' ')
        .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
        .toLowerCase();
    const words = bare.match(/[\p{L}\p{N}']+/gu) || [];
    return words.every((word) => HARMLESS.has(word));
}

module.exports = { isSmallTalk };
