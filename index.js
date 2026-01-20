/*
    * All of this is a 1:1 copy of NotEnoughUpdates' UrsaClient, session handling included.
    * 0 data is stored, sent, or accessed outside of what is sent to the Ursa API, of which I have no control over.
    * Data sent to the Ursa API includes the username and a randomized serverID used to verify that the account used is real,
    * or an Ursa token from a previous successful verification.
    *
    * If you use NEU, you have already used this code.
    *
    * Credit to Moulberry for the original implementation
    * Proofs:
    * https://github.com/NotEnoughUpdates/NotEnoughUpdates/blob/master/src/main/kotlin/io/github/moulberry/notenoughupdates/util/UrsaClient.kt
    * https://github.com/NotEnoughUpdates/ursa-minor
*/

import { fetch } from "../ZRequest/fetch"

const versionToInt = (version) => {
    const [major, minor, patch] = version.split(".").map(Number)
    return Number(
        `${major}${String(minor).padStart(2, "0")}${String(patch).padStart(2, "0")}`
    )
}

const mc = Client.getMinecraft()
const ForgeVersion = GetJavaClass("net.minecraftforge.common.ForgeVersion")
let _gameVersion = Client.getVersion()
if (Object.keys(ForgeVersion).length > 0) {
    _gameVersion = ForgeVersion.mcVersion
}
const gameVersion = versionToInt(_gameVersion)
const isLegacy = gameVersion < 12100

const UUID = Java.type("java.util.UUID")
const ChatLog = (prefix, ...strings) => ChatLib.chat("§6[§9UrsaMinor§6] §r" + prefix + strings.join(" | "))
const AuthenticationState = {
    NOT_ATTEMPTED: "NOT_ATTEMPTED",
    FAILED_TO_JOINSERVER: "FAILED_TO_JOINSERVER",
    INVALID_SESSION_TOKEN: "INVALID_SESSION_TOKEN",
    REJECTED: "REJECTED",
    SUCCEEDED: "SUCCEEDED",
    OUTDATED: "OUTDATED",
}
const maxRetryCount = 3
const retryDelayMs = 1000
const debug = true

export const profilesPath = (uuid) => `v1/hypixel/v2/profiles/${uuid}`
export const playerPath = (uuid) => `v1/hypixel/v2/player/${uuid}`
export const guildPath = (uuid) => `v1/hypixel/v2/guild/${uuid}`
export const bingoPath = (uuid) => `v1/hypixel/v2/bingo/${uuid}`
export const museumForProfile = (profileUuid) => `v1/hypixel/v2/museum/${profileUuid}`
export const gardenForProfile = (profileUuid) => `v1/hypixel/v2/garden/${profileUuid}`
export const statusPath = (uuid) => `v1/hypixel/v2/status/${uuid}`

// const randomServerId = UUID.randomUUID().toString()
// let authenticationHeaders = null

let delayedCallbacks = {}
function StartDelayedCallback(delayID, delayMs, callback) {
    let isScheduled = delayedCallbacks.hasOwnProperty(delayID)
    delayedCallbacks[delayID] = Date.now()
    if (isScheduled) return

    let stepRegister = register("step", () => {
        if (Date.now() - delayedCallbacks[delayID] >= delayMs) {
            callback()
            delete delayedCallbacks[delayID]
            stepRegister.unregister()
        }
    }).setFps(20)
}

class UrsaToken {
    constructor(validUntil, ursaToken, obtainedFrom) {
        this.validUntil = validUntil
        this.ursaToken = ursaToken
        this.obtainedFrom = obtainedFrom
    }

    isValid() {
        return Date.now() + 60000 < this.validUntil
    }
}
class Request {
    constructor(path, callback) {
        this.path = path
        this.callback = callback
    }
}
class UrsaClient {
    constructor() {
        this.isPollingForUrsaToken = false
        this.ursaToken = null
        this.queue = []
        this.ursaRoot = "https://ursa.notenoughupdates.org"
        this.authenticationState = AuthenticationState.NOT_ATTEMPTED

        register("tick", () => {
            this.bumpRequests()
        })
    }
    authorizeRequest(ursaToken = null) {
        let headers = {}
        if (ursaToken != null && ursaToken.obtainedFrom == this.ursaRoot) {
            if (debug) ChatLog("Authorizing request using Ursa Token")
            headers["x-ursa-token"] = ursaToken.ursaToken
        } else {
            // if (authenticationHeaders != null) return authenticationHeaders

            if (debug) ChatLog("Authorizing request using username and serverId")
            const randomServerId = UUID.randomUUID().toString()
            if (isLegacy) {
                // I don't save this, read top of file
                const session = Client.getMinecraft().func_110432_I() // Client.getMinecraft().getSession() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_110432_I
                const username = session.func_111285_a() // session.getUsername() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_111285_a

                headers["x-ursa-username"] = username
                headers["x-ursa-serverid"] = randomServerId

                // Joins a random server to verify the account is real
                Client.getMinecraft().func_152347_ac().joinServer( // Client.getMinecraft().getSessionService() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_152347_ac
                    session.func_148256_e(), // session.getProfile() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_148256_e
                    session.func_148254_d(), // session.getAccessToken() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_148254_d
                    randomServerId,
                )
            } else {
                // I don't save this, read top of file
                const session = Client.getMinecraft().session
                const username = session.getUsername()

                headers["x-ursa-username"] = username
                headers["x-ursa-serverid"] = randomServerId

                // Joins a random server to verify the account is real
                Client.getMinecraft().getSessionService().joinServer(
                    session.getUuidOrNull(),
                    session.getAccessToken(),
                    randomServerId,
                )
            }
            if (debug) ChatLog("Authorizing request using username and serverId complete")
        }

        // authenticationHeaders = headers
        return headers
    }

    saveUrsaToken(responseHeaders) {
        if (debug) ChatLog("Attempting to save Ursa token")
        const ursaTokenHeader = responseHeaders["X-Ursa-Token"]
        const expiresHeader = responseHeaders["X-Ursa-Expires"]

        let validUntil = Date.now() + 55 * 60 * 1000
        if (expiresHeader) {
            try {
                validUntil = parseInt(expiresHeader)
            } catch (e) { }
        }

        if (ursaTokenHeader == null) {
            this.isPollingForUrsaToken = false
            if (debug) ChatLog("No Ursa token found. Marking as non polling")
        } else {
            this.ursaToken = new UrsaToken(validUntil, ursaTokenHeader, this.ursaRoot)
            this.isPollingForUrsaToken = false
            this.authenticationState = AuthenticationState.SUCCEEDED
            if (debug) ChatLog("Ursa Token saving successful")
        }
    }
    performRequest(req, ursaToken) {
        const url = `${this.ursaRoot}/${req.path}`

        try {
            if (debug) ChatLog("Ursa Request started")
            const headers = this.authorizeRequest(ursaToken)
            if (debug) ChatLog(`Sending request to ${url} with headers ${JSON.stringify(headers)}`)
            fetch(url, {
                headers: headers,
                json: true,
                timeout: 10000,
            })
            .then((response) => {
                if (debug) ChatLog(`Request completed.`)
                this.saveUrsaToken(response.headers || {})
                req.callback(true, response)
            })
            .catch((e) => {
                ChatLog(`§cRequest failed: ${JSON.stringify(req)}|${e.message}|${e.stack}`)
                this.isPollingForUrsaToken = false

                const errorMessage = e.toString()
                if (errorMessage.includes("AuthenticationException")) {
                    this.authenticationState = AuthenticationState.FAILED_TO_JOINSERVER
                } else if (errorMessage.includes("InvalidCredentialsException")) {
                    this.authenticationState = AuthenticationState.INVALID_SESSION_TOKEN
                }
                if (e.statusCode == 401) {
                    this.authenticationState = AuthenticationState.REJECTED
                    this.ursaToken = null
                }
                req.callback(false, e)
            })
        } catch (e) {
            ChatLog(`§cRequest failed: ${e.message}|${e.stack}`)
            this.isPollingForUrsaToken = false
            req.callback(false, e)
        }
    }
    bumpRequests() {
        while (this.queue.length > 0) {
            if (this.isPollingForUrsaToken) return

            const nextRequest = this.queue.shift()
            if (nextRequest == null) {
                if (debug) ChatLog("No request to bump found")
                return
            }

            if (debug) ChatLog("Request found")
            let ursaToken = this.ursaToken

            if (!(ursaToken != null && ursaToken.isValid() && ursaToken.obtainedFrom == this.ursaRoot)) {
                this.isPollingForUrsaToken = true
                ursaToken = null
                if (this.ursaToken != null) {
                    if (debug) ChatLog("Disposing old invalid ursa token.")
                    this.ursaToken = null
                }
                if (debug) ChatLog("No Ursa token saved. Marking this request as a Ursa token poll request")
            }
            this.performRequest(nextRequest, ursaToken)
        }
    }
    clearUrsaToken() {
        this.ursaToken = null
    }
    get(path, callback) {
        this.queue.push(new Request(path, callback))
    }
    getAuthenticationState() {
        if (this.authenticationState == AuthenticationState.SUCCEEDED && (this.ursaToken == null || !this.ursaToken?.isValid())) {
            return AuthenticationState.OUTDATED
        }
        return this.authenticationState
    }
    getWithRetrys(path, callback, currentRetryCount = 0) {
        this.get(path, (success, data) => {
            if (!success && currentRetryCount < maxRetryCount) {
                if (this.authenticationState == AuthenticationState.REJECTED) {
                    ChatLog("§cUrsa request rejected. Not retrying.")
                    callback(false, data)
                    return
                } else if (this.authenticationState == AuthenticationState.INVALID_SESSION_TOKEN) {
                    ChatLog("§cUrsa request failed due to invalid session token. Not retrying.")
                    callback(false, data)
                    return
                }

                if (debug) ChatLog(`Request failed, retrying ${currentRetryCount + 1}/${maxRetryCount}`)
                StartDelayedCallback(`ursaRetry${path}`, retryDelayMs, () => {
                    this.getWithRetrys(path, callback, currentRetryCount + 1)
                })
                return
            }
            callback(success, data)
        })
    }
    getProfiles = (uuid, callback) => {
        this.getWithRetrys(profilesPath(uuid), callback)
    }
    getPlayer = (uuid, callback) => {
        this.getWithRetrys(playerPath(uuid), callback)
    }
    getGuild = (uuid, callback) => {
        this.getWithRetrys(guildPath(uuid), callback)
    }
    getBingo = (uuid, callback) => {
        this.getWithRetrys(bingoPath(uuid), callback)
    }
    getMuseumForProfile = (profileUuid, callback) => {
        this.getWithRetrys(museumForProfile(profileUuid), callback)
    }
    getGardenForProfile = (profileUuid, callback) => {
        this.getWithRetrys(gardenForProfile(profileUuid), callback)
    }
    getStatus = (uuid, callback) => {
        this.getWithRetrys(statusPath(uuid), callback)
    }
}
export const ursaClient = new UrsaClient()
