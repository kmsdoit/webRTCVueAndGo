
class Video {
    host = ""
    
    async RestPost(url, body) {
        const req = await fetch(`${this.host}${url}`, {
            credentials: 'include',
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        const res = await req.json();
        console.log(`POST ${url} :`, res);
        return res;
    }

    async openLocalStream(capWidth, capHeight) {
        try {
            return await navigator.mediaDevices.getUserMedia(
                { 
                    video: {
                        //facingMode: { exact: "environment" },
                        width: { min: capWidth, ideal: capWidth, max: capWidth },
                        height: { min: capHeight, ideal: capHeight, max: capHeight },
                        "frameRate": 30
                    },
                    // video: true,
                    audio: true
                });
        } catch (e) {
            console.log(e);
        }
    }

    publish(stream, userId, channelId, token, callback) {
        return new Promise((resolve, reject) => {
            let peer = {
                videoStream: stream,
                audioStream: stream
            };

            let videoTrack = stream.getVideoTracks()[0];
            let videoSettings = videoTrack.getSettings();
            console.log("video settings:", videoSettings);

            let audioTrack = stream.getAudioTracks()[0];
            let audioSettings = audioTrack.getSettings();
            console.log("audio settings:", audioSettings);

            let pc = new RTCPeerConnection({
                iceServers: [
                    {
                        urls: 'stun:stun.l.google.com:19302'
                    }
                ]
            })

            let eventCallback = (v) => {
                console.log("eventCallback: ", v);
                if (v.state == "disconnected" || v.state == "failed") {
                    setTimeout(() => {
                        pc.close();
                        this.publish(stream, userId, channelId, token, callback);                        
                    }, 100);

                }
                if (callback) callback(v);
            }

            stream.getTracks().forEach(track => pc.addTrack(track, stream))
            pc.createOffer().then(d => {
                pc.setLocalDescription(d)

                this.RestPost('http://14.63.1.34:18080/api/publish', {
                    "token": token,
                    "userId": userId,
                    "channelId": channelId,
                    "video": {
                        "width": videoSettings.width,
                        "height": videoSettings.height,
                        "frameRate": videoSettings.frameRate    
                    },
                    "audio": {
                        "sampleRate": audioSettings.sampleRate,
                        "sampleSize": audioSettings.sampleSize,
                        "channelCount": audioSettings.channelCount    
                    },
                    "mediaDesc": d
                }).then(answer => {
                    console.log("join answer: ", answer)
                    if (answer.error && answer.error.length > 0) {
                        pc.close();
                        setTimeout(() => {
                            eventCallback({
                                state: "failed",
                                stream,
                                channelId, 
                                token
                            });
                        }, 1000);    
                        reject(answer.error);
                        return;
                    }

                    pc.setRemoteDescription(new RTCSessionDescription(answer.answer))
                    console.log(`${channelId} published!`);
                    resolve(peer);
                    return;
                }).catch(e => {
                    pc.close();                    
                    console.log(e);
                    setTimeout(() => {
                        eventCallback({
                            state: "failed",
                            stream,
                            channelId, 
                            token
                        });
                    }, 1000);
                    reject(e);
                    return;
                });

            }).catch((e) => {
                pc.close();
                console.log(e);
                reject(e);
                return;
            })

            pc.oniceconnectionstatechange = () => {
                console.log(pc.iceConnectionState)
                eventCallback({
                    state: pc.iceConnectionState,
                    stream,
                    channelId, 
                    token
                });
            }
            pc.onicecandidate = event => {
                if (event.candidate === null) {
                    console.log(event)
                }
            }

            peer.pc = pc;

        });
    }


    subscribe(video, userId, channelId, enAudio, enVideo, token, callback) {
        return new Promise((resolve, reject) => {
            let peer = {
                videoStream: null,
                audioStream: null
            };

            let pc = new RTCPeerConnection({
                iceServers: [
                    {
                        urls: 'stun:stun.l.google.com:19302'
                    }
                ]
            });

            let onLoadedData = () => {
                startedTime = (new Date()).getTime();
                video.play();
            }

            let retried = false;
            let startedTime = 0;

            let reconnect = () => {
                if (retried) return;

                setTimeout(() => {
                    video.removeEventListener('loadeddata', onLoadedData, false);
                    pc.close();
                    this.subscribe(video, userId, channelId, enAudio, enVideo, token, callback);
                }, 100);
                retried = true;
            }

            let onVideoError = (e) => {
                console.log("video-error: ", e);
                reconnect();
            }

            let watchDog = () => {
                let now = (new Date()).getTime();
                let expectedTime = (now - startedTime) / 1000;
                if (pc.connectionState == 'disconnected' || pc.connectionState == 'failed' || pc.connectionState == 'closed' || expectedTime - video.currentTime > 3) {
                    console.log("needed to reconnect");
                    reconnect();
                } else {
                    setTimeout(watchDog, 1000);
                }
            }

            let eventCallback = (v) => {
                console.log("subscribe eventCallback: ", v);
                if (v.state == "disconnected" || v.state == "failed" || v.state == "notfound") {
                    reconnect();
                }
                if(callback) callback(v);
            }

            let done = (v) => {
                video.srcObject = v.videoStream;
                video.addEventListener('loadeddata', onLoadedData);
                video.addEventListener("error", onVideoError);
                startedTime = (new Date()).getTime();
                setTimeout(watchDog, 1000);
                resolve(v);
            }

            pc.ontrack = (event) => {
                console.log("event.track.kind", event.track.kind);

                if (event.track.kind == "video") {
                    peer.videoStream = event.streams[0];
                    if (!enAudio) {
                        done(peer);
                    } else {
                        if (peer.audioStream) {
                            done(peer);
                        }
                    }
                } else if (event.track.kind == "audio") {
                    var el = document.createElement("audio");
                    el.srcObject = event.streams[0]
                    el.addEventListener('loadeddata', () => {
                        el.play();
                    });
                    el.autoplay = true;
                    el.controls = false;
                    peer.audioEle = el;
                    document.body.appendChild(el);
                    peer.audioStream = event.streams[0];
                    if (!enVideo) {
                        done(peer)
                    } else {
                        if (peer.videoStream) {
                            done(peer);
                        }
                    }
                }
            }

            pc.oniceconnectionstatechange = () => {
                console.log(pc.iceConnectionState)
                eventCallback({
                    state: pc.iceConnectionState,
                    userId, 
                    channelId, 
                    enAudio, 
                    enVideo, 
                    token
                });
            }

            // Offer to receive 1 audio, and 2 video tracks
            if (enVideo) {
                pc.addTransceiver('video', { 'direction': 'recvonly' })
            }

            if (enAudio) {
                pc.addTransceiver('audio', { 'direction': 'recvonly' })
            }

            pc.createOffer().then(d => {
                pc.setLocalDescription(d)
                this.RestPost("http://14.63.1.34:18080/api/subscribe", {
                    "token": token,
                    "userId": userId,
                    "channelId": channelId,
                    "mediaDesc": d
                })
                    .then(e => {
                        if (e.status == 200) {
                            pc.setRemoteDescription(new RTCSessionDescription(e.answer));
                        } else  {
                            if (e.status == 404) {
                                setTimeout(() => {
                                    eventCallback({
                                        state: "notfound",
                                        userId, 
                                        channelId, 
                                        enAudio, 
                                        enVideo, 
                                        token
                                    });
                                }, 300);
                            }
                            pc.close();
                            reject(e);
                            return;
                        }
                    }).catch( e => {
                        pc.close();
                        setTimeout(() => {
                            eventCallback({
                                state: "failed",
                                userId, 
                                channelId, 
                                enAudio, 
                                enVideo, 
                                token
                            });
                        }, 1000);
                        reject(e);
                        return;
                    });

            }).catch((e) => {
                pc.close();
                console.log(e);
                reject(e);
                return;
            });

            peer.pc = pc;
        });
    }
}

window.$video = new Video();
