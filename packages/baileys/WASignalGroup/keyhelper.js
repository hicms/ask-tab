const curve = require('../libsignal/src/curve');

exports.generateSenderKey = function() {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return Buffer.from(buf);
}

exports.generateSenderKeyId = function() {
    return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7FFFFFFF;
}

exports.generateSenderSigningKey = function(key) {
    if (!key) {
        key = curve.generateKeyPair();
    }

    return {
        public: key.pubKey,
        private: key.privKey,
    };
} 
