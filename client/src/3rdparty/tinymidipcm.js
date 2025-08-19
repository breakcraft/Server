import loadTinyMidiPCM from '#3rdparty/tinymidipcm/tinymidipcm.mjs';

class TinyMidiPCM {
    constructor(options = {}) {
        this.wasmModule = undefined;

        this.soundfontBufferPtr = 0;
        this.soundfontPtr = 0;

        this.midiBufferPtr = 0;

        this.renderInterval = options.renderInterval || 100;

        this.sampleRate = options.sampleRate || 44100;
        this.channels = options.channels || 2;
        this.gain = options.gain || 0;

        if (!options.bufferSize) {
            this.setBufferDuration(1);
        } else {
            this.bufferSize = options.bufferSize;
        }

        this.onPCMData = options.onPCMData || (() => {});
        this.onRenderEnd = options.onRenderEnd || (() => {});

        this.renderTimer = undefined;

        this.test = 0;
    }

    async init() {
        if (this.wasmModule) {
            return;
        }

        // check if node
        // http://philiplassen.com/2021/08/11/node-es6-emscripten.html
        // if (typeof process !== 'undefined') {
        //     const { dirname } = await import(/* webpackIgnore: true */ 'path');
        //     const { createRequire } = await import(/* webpackIgnore: true */ 'module');

        //     globalThis.__dirname = dirname(import.meta.url);
        //     globalThis.require = createRequire(import.meta.url);
        // }

        this.wasmModule = await loadTinyMidiPCM();

        this.pcmBufferPtr = this.wasmModule._malloc(this.bufferSize);
        this.msecsPtr = this.wasmModule._malloc(8);
    }

    // set buffer size based on seconds
    setBufferDuration(seconds) {
        this.bufferSize = 4 * this.sampleRate * this.channels * seconds;
    }

    ensureInitialized() {
        if (!this.wasmModule) {
            throw new Error(`${this.constructor.name} not initalized. call .init()`);
        }
    }

    setSoundfont(buffer) {
        this.ensureInitialized();

        const { _malloc, _free, _tsf_load_memory, _tsf_set_output } = this.wasmModule;

        _free(this.soundfontBufferPtr);

        this.soundfontBufferPtr = _malloc(buffer.length);
        this.wasmModule.HEAPU8.set(buffer, this.soundfontBufferPtr);

        this.soundfontPtr = _tsf_load_memory(this.soundfontBufferPtr, buffer.length);

        _tsf_set_output(this.soundfontPtr, this.channels === 2 ? 0 : 2, this.sampleRate, this.gain);
    }

    getPCMBuffer() {
        this.ensureInitialized();

        const pcm = new Uint8Array(this.bufferSize);

        pcm.set(this.wasmModule.HEAPU8.subarray(this.pcmBufferPtr, this.pcmBufferPtr + this.bufferSize));

        return pcm;
    }

    getMIDIMessagePtr(midiBuffer) {
        const { _malloc, _free, _tml_load_memory } = this.wasmModule;

        _free(this.midiBufferPtr);

        this.midiBufferPtr = _malloc(midiBuffer.length);
        this.wasmModule.HEAPU8.set(midiBuffer, this.midiBufferPtr);

        return _tml_load_memory(this.midiBufferPtr, midiBuffer.length);
    }

    renderMIDIMessage(midiMessagePtr) {
        const { _midi_render } = this.wasmModule;

        return _midi_render(this.soundfontPtr, midiMessagePtr, this.channels, this.sampleRate, this.pcmBufferPtr, this.bufferSize, this.msecsPtr);
    }

    render(midiBuffer) {
        this.ensureInitialized();

        if (!this.soundfontPtr) {
            throw new Error('no soundfont buffer set. call .setSoundfont');
        }

        window.clearTimeout(this.renderTimer);

        const { setValue, getValue, _tsf_reset, _tsf_channel_set_bank_preset } = this.wasmModule;

        setValue(this.msecsPtr, 0, 'double');

        _tsf_reset(this.soundfontPtr);
        _tsf_channel_set_bank_preset(this.soundfontPtr, 9, 128, 0);

        let midiMessagePtr = this.getMIDIMessagePtr(midiBuffer);

        const boundRender = function () {
            midiMessagePtr = this.renderMIDIMessage(midiMessagePtr);

            const pcm = this.getPCMBuffer();

            this.onPCMData(pcm);

            if (midiMessagePtr) {
                this.renderTimer = setTimeout(boundRender, this.renderInterval);
            } else {
                this.onRenderEnd(getValue(this.msecsPtr, 'double'));
            }
        }.bind(this);

        this.renderTimer = setTimeout(() => {
            boundRender();
        }, 16);
    }
}

// controlling tinymidipcm:
(async () => {
    const channels = 2;
    const sampleRate = 44100;
    const flushTime = 250;
    const renderInterval = 30;
    const fadeseconds = 2;

    let midiTimeout = null;
    let fadeTimeout = null;
    // let renderEndSeconds = 0;
    // let currentMidiBuffer = null;
    let samples = new Float32Array();

    let gainNode = window.audioContext.createGain();
    gainNode.gain.setValueAtTime(0.1, window.audioContext.currentTime);
    gainNode.connect(window.audioContext.destination);

    // let startTime = 0;
    let lastTime = window.audioContext.currentTime;
    let bufferSources = [];

    const tinyMidiPCM = new TinyMidiPCM({
        renderInterval,
        onPCMData: pcm => {
            let float32 = new Float32Array(pcm.buffer);
            let temp = new Float32Array(samples.length + float32.length);
            temp.set(samples, 0);
            temp.set(float32, samples.length);
            samples = temp;
        },
        onRenderEnd: ms => {
            // renderEndSeconds = Math.floor(startTime + Math.floor(ms / 1000));
        },
        bufferSize: 1024 * 100
    });

    await tinyMidiPCM.init();

    const soundfontRes = await fetch(new URL('SCC1_Florestan.sf2', import.meta.url));
    const soundfontBuffer = new Uint8Array(await soundfontRes.arrayBuffer());
    tinyMidiPCM.setSoundfont(soundfontBuffer);

    function flush() {
        if (!window.audioContext || !samples.length) {
            return;
        }

        let bufferSource = window.audioContext.createBufferSource();
        // bufferSource.onended = function(event) {
        //     const timeSeconds = Math.floor(window.audioContext.currentTime);

        //     if (renderEndSeconds > 0 && Math.abs(timeSeconds - renderEndSeconds) <= 2) {
        //         renderEndSeconds = 0;

        //         if (currentMidiBuffer) {
        //             // midi looping
        //             // note: this was buggy with some midi files
        //             window._tinyMidiPlay(currentMidiBuffer, -1);
        //         }
        //     }
        // }

        const length = samples.length / channels;
        const audioBuffer = window.audioContext.createBuffer(channels, length, sampleRate);

        for (let channel = 0; channel < channels; channel++) {
            const audioData = audioBuffer.getChannelData(channel);

            let offset = channel;
            for (let i = 0; i < length; i++) {
                audioData[i] = samples[offset];
                offset += channels;
            }
        }

        if (lastTime < window.audioContext.currentTime) {
            lastTime = window.audioContext.currentTime;
        }

        bufferSource.buffer = audioBuffer;
        bufferSource.connect(gainNode);
        bufferSource.start(lastTime);
        bufferSources.push(bufferSource);

        lastTime += audioBuffer.duration;
        samples = new Float32Array();
    }

    let flushInterval;

    function fadeOut(callback) {
        const currentTime = window.audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(currentTime);
        gainNode.gain.setTargetAtTime(0, currentTime, 0.5);
        return setTimeout(callback, fadeseconds * 1000);
    }

    function stop() {
        if (flushInterval) {
            clearInterval(flushInterval);
        }

        // currentMidiBuffer = null;
        samples = new Float32Array();

        if (bufferSources.length) {
            let temp = gainNode.gain.value;
            gainNode.gain.setValueAtTime(0, window.audioContext.currentTime);
            bufferSources.forEach(bufferSource => {
                bufferSource.stop(window.audioContext.currentTime);
            });
            bufferSources = [];
            gainNode.gain.setValueAtTime(temp, window.audioContext.currentTime);
        }
    }

    function start(vol, midiBuffer) {
        // vol -1 = reuse last volume level
        if (vol !== -1) {
            window._tinyMidiVolume(vol);
        }

        // currentMidiBuffer = midiBuffer;
        // startTime = window.audioContext.currentTime;
        lastTime = window.audioContext.currentTime;
        flushInterval = setInterval(flush, flushTime);
        tinyMidiPCM.render(midiBuffer);
    }

    window._tinyMidiStop = async fade => {
        if (fade) {
            fadeTimeout = fadeOut(() => {
                stop();
            });
        } else {
            stop();
            clearTimeout(midiTimeout);
            clearTimeout(fadeTimeout);
        }
    };

    window._tinyMidiVolume = (vol = 1) => {
        gainNode.gain.setValueAtTime(vol, window.audioContext.currentTime);
    };

    window._tinyMidiPlay = async (midiBuffer, vol, fade) => {
        if (!midiBuffer) {
            return;
        }

        await window._tinyMidiStop(fade);

        if (fade) {
            midiTimeout = setTimeout(() => {
                start(vol, midiBuffer);
            }, fadeseconds * 1000);
        } else {
            start(vol, midiBuffer);
        }
    };
})();

export function playMidi(data, vol, fade) {
    if (window._tinyMidiPlay) {
        window._tinyMidiPlay(data, vol / 128, fade);
    }
}

export function setMidiVolume(vol) {
    if (window._tinyMidiVolume) {
        window._tinyMidiVolume(vol / 128);
    }
}

export function stopMidi(fade) {
    if (window._tinyMidiStop) {
        window._tinyMidiStop(fade);
    }
}
