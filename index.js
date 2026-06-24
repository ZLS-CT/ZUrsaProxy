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
import { isLegacy, gameVersion, StartDelayedCallback, _ChatDebug, ChatDebug, } from "../ZCore"

const maxRetryCount = 3
const retryDelayMs = 1000
const chatPrefix = "§6[§9UrsaMinor§6] §r"
let lastServerID = null
const debug = false

const AuthenticationState = {
    NOT_ATTEMPTED: "NOT_ATTEMPTED",
    FAILED_TO_JOINSERVER: "FAILED_TO_JOINSERVER",
    INVALID_SESSION_TOKEN: "INVALID_SESSION_TOKEN",
    MICROSOFT_RATE_LIMIT: "MICROSOFT_RATE_LIMIT",
    URSA_RATE_LIMIT: "URSA_RATE_LIMIT",
    REJECTED: "REJECTED",
    SUCCEEDED: "SUCCEEDED",
    OUTDATED: "OUTDATED",
}
const ChatLog = (...strings) => _ChatDebug(chatPrefix, strings)

export const profilesPath = (uuid) => `v1/hypixel/v2/profiles/${uuid}`
export const playerPath = (uuid) => `v1/hypixel/v2/player/${uuid}`
export const guildPath = (uuid) => `v1/hypixel/v2/guild/${uuid}`
export const bingoPath = (uuid) => `v1/hypixel/v2/bingo/${uuid}`
export const museumForProfile = (profileUuid) => `v1/hypixel/v2/museum/${profileUuid}`
export const gardenForProfile = (profileUuid) => `v1/hypixel/v2/garden/${profileUuid}`
export const statusPath = (uuid) => `v1/hypixel/v2/status/${uuid}`

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
    constructor(path, forceRejoin, callback) {
        this.path = path
        this.forceRejoin = forceRejoin
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
            try {
                this.bumpRequests()
            } catch (e) { }
        })
    }
    authorizeRequest(req, ursaToken = null) {
        let headers = {}
        if (ursaToken != null && ursaToken.obtainedFrom == this.ursaRoot) {
            if (debug) ChatDebug("Authorizing request using Ursa Token")
            headers["x-ursa-token"] = ursaToken.ursaToken
            return headers
        }

        if (debug) ChatDebug("Authorizing request using username and serverId")
        const randomServerId = UUID.randomUUID().toString()
        if (isLegacy) {
            // I don't save this, read top of file
            const session = Client.getMinecraft().func_110432_I() // Client.getMinecraft().getSession() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_110432_I
            const username = session.func_111285_a() // session.getUsername() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_111285_a
            headers["x-ursa-username"] = username
            if (!req.forceRejoin && lastServerID) {
                return {
                    ...headers,
                    "x-ursa-serverid": lastServerID,
                }
            }
            headers["x-ursa-serverid"] = randomServerId
            lastServerID = randomServerId

            // Joins a random server to verify the account is real
            Client.getMinecraft().func_152347_ac().joinServer( // Client.getMinecraft().getSessionService() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_152347_ac
                session.func_148256_e(), // session.getProfile() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_148256_e
                session.func_148254_d(), // session.getAccessToken() - Check here https://wagyourtail.xyz/Projects/MinecraftMappingViewer/App?version=1.8.9&mapping=YARN,SRG,MCP&search=func_148254_d
                randomServerId,
            )
            return headers
        }

        // I don't save this, read top of file
        const session = Client.getMinecraft().user
        const username = session.getName()
        headers["x-ursa-username"] = username
        if (!req.forceRejoin && lastServerID) {
            return {
                ...headers,
                "x-ursa-serverid": lastServerID,
            }
        }
        headers["x-ursa-serverid"] = randomServerId
        lastServerID = randomServerId

        // Joins a random server to verify the account is real
        if (gameVersion >= 12109) {
            Client.getMinecraft().services().sessionService().joinServer(
                session.getProfileId(),
                session.getAccessToken(),
                randomServerId,
            )
            return headers
        }
        Client.getMinecraft().getSessionService().joinServer(
            session.getUuidOrNull(),
            session.getAccessToken(),
            randomServerId,
        )
        return headers
    }
    saveUrsaToken(responseHeaders) {
        if (debug) ChatDebug("Attempting to save Ursa token")
        const ursaTokenHeader = responseHeaders["x-ursa-token"]
        const expiresHeader = responseHeaders["x-ursa-expires"]

        let validUntil = Date.now() + 55 * 60 * 1000
        if (expiresHeader) {
            try {
                validUntil = parseInt(expiresHeader)
            } catch (e) { }
        }

        if (ursaTokenHeader == null) {
            this.isPollingForUrsaToken = false
            if (debug) ChatDebug("No Ursa token found. Marking as non polling")
        } else {
            this.ursaToken = new UrsaToken(validUntil, ursaTokenHeader, this.ursaRoot)
            this.isPollingForUrsaToken = false
            this.authenticationState = AuthenticationState.SUCCEEDED
            if (debug) ChatDebug("Ursa Token saving successful")
        }
    }
    catchRequestErrors(req, e) {
        if (debug) ChatDebug(`Request failed with error: ${e.message}`, e.stack)
        this.isPollingForUrsaToken = false
        const errorMessage = e.toString()
        if (errorMessage.includes("AuthenticationException")) {
            this.authenticationState = AuthenticationState.MICROSOFT_RATE_LIMIT
        } else if (errorMessage.includes("InvalidCredentialsException")) {
            this.authenticationState = AuthenticationState.INVALID_SESSION_TOKEN
        } else if (errorMessage.includes("429 Rate limit exceeded")) {
            this.authenticationState = AuthenticationState.URSA_RATE_LIMIT
        }

        if (e.statusCode == 401) {
            this.authenticationState = AuthenticationState.REJECTED
            this.ursaToken = null
        }
        req.callback(false, {
            error: e,
            state: this.authenticationState,
        })
    }
    performRequest(req, ursaToken) {
        const url = `${this.ursaRoot}/${req.path}`
        try {
            if (debug) ChatDebug("Ursa Request started")
            const headers = this.authorizeRequest(req, ursaToken)
            if (debug) ChatDebug(`Sending request to ${url} with headers ${JSON.stringify(headers)} and request ${JSON.stringify(req)}`)
            fetch(url, {
                headers: headers,
                fullResponse: true,
                timeout: 10000,
            })
            .then((response) => {
                if (debug) ChatDebug(`Response received for ${url}.`)
                let _responseJSON = null

                if (response.body && response.body.includes("429 Rate limit exceeded")) {
                    throw new Error("429 Rate limit exceeded")
                }

                try {
                    _responseJSON = JSON.parse(response.body)
                } catch (e) {
                    if (debug) ChatDebug(`Failed to parse JSON response: ${e.message}`)
                    throw e
                }
                req.callback(true, _responseJSON)
                this.saveUrsaToken(response.headers || {})
                if (debug) ChatDebug(`Request completed.`)
            })
            .catch((e) => {
                this.catchRequestErrors(req, e)
            })
        } catch (e) {
            this.catchRequestErrors(req, e)
        }
    }
    bumpRequests() {
        while (this.queue.length > 0) {
            if (this.isPollingForUrsaToken) return

            const nextRequest = this.queue.shift()
            if (nextRequest == null) {
                if (debug) ChatDebug("No request to bump found")
                return
            }

            if (debug) ChatDebug("Request found")
            let ursaToken = this.ursaToken

            if (!(ursaToken != null && ursaToken.isValid() && ursaToken.obtainedFrom == this.ursaRoot)) {
                this.isPollingForUrsaToken = true
                ursaToken = null
                if (this.ursaToken != null) {
                    if (debug) ChatDebug("Disposing old invalid ursa token.")
                    this.ursaToken = null
                }
                if (debug) ChatDebug("No Ursa token saved. Marking this request as a Ursa token poll request")
            }
            this.performRequest(nextRequest, ursaToken)
        }
    }
    clearUrsaToken() {
        this.ursaToken = null
    }
    getAuthenticationState() {
        if (this.authenticationState == AuthenticationState.SUCCEEDED && (this.ursaToken == null || !this.ursaToken?.isValid())) {
            return AuthenticationState.OUTDATED
        }
        return this.authenticationState
    }
    get(path, forceRejoin, callback) {
        this.queue.push(new Request(path, forceRejoin, callback))
    }
    getWithRetrys(path, callback, _forceRejoin = true, _maxRetryCount = maxRetryCount, currentRetryCount = 0) {
        this.get(path, _forceRejoin, (success, data) => {
            if (!success && currentRetryCount < _maxRetryCount) {
                if (this.authenticationState == AuthenticationState.REJECTED) {
                    ChatLog("§cUrsa request rejected. Not retrying.")
                    callback(false, data)
                    return
                } else if (this.authenticationState == AuthenticationState.INVALID_SESSION_TOKEN) {
                    ChatLog("§cUrsa request failed due to invalid session token. Not retrying.")
                    callback(false, data)
                    return
                }

                if (debug) ChatDebug(`Request failed, retrying ${currentRetryCount + 1}/${_maxRetryCount}`)
                StartDelayedCallback(`ursaRetry${path}`, retryDelayMs, () => {
                    this.getWithRetrys(path, callback, false, _maxRetryCount, currentRetryCount + 1)
                })
                return
            }
            callback(success, data)
        })
    }
    getProfiles = (uuid, callback, _forceRejoin = true, _maxRetryCount = 0) => {
        this.getWithRetrys(profilesPath(uuid), callback, _forceRejoin, _maxRetryCount)
    }
    getPlayer = (uuid, callback, _forceRejoin = true, _maxRetryCount = 0) => {
        this.getWithRetrys(playerPath(uuid), callback, _forceRejoin, _maxRetryCount)
    }
    getGuild = (uuid, callback, _forceRejoin = true, _maxRetryCount = 0) => {
        this.getWithRetrys(guildPath(uuid), callback, _forceRejoin, _maxRetryCount)
    }
    getBingo = (uuid, callback, _forceRejoin = true, _maxRetryCount = 0) => {
        this.getWithRetrys(bingoPath(uuid), callback, _forceRejoin, _maxRetryCount)
    }
    getMuseumForProfile = (profileUuid, callback, _forceRejoin = true, _maxRetryCount = 0) => {
        this.getWithRetrys(museumForProfile(profileUuid), callback, _forceRejoin, _maxRetryCount)
    }
    getGardenForProfile = (profileUuid, callback, _forceRejoin = true, _maxRetryCount = 0) => {
        this.getWithRetrys(gardenForProfile(profileUuid), callback, _forceRejoin, _maxRetryCount)
    }
    getStatus = (uuid, callback, _forceRejoin = true, _maxRetryCount = 0) => {
        this.getWithRetrys(statusPath(uuid), callback, _forceRejoin, _maxRetryCount)
    }
}
export const ursaClient = new UrsaClient()
