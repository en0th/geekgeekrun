package io.geekgeekrun.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/** Native transport only. No token logging, redirects, cookie import or auto replay. */
@CapacitorPlugin(name = "MobileBridge")
public class MobileBridgePlugin extends Plugin {
    private static final String VAULT = "geekgeekrun.session.v1";
    private static final int MAX_RESPONSE = 32 * 1024 * 1024;
    private final Map<String, Call> calls = new ConcurrentHashMap<>();
    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build();

    private void event(String channel, String id, String kind, String data) {
        JSObject value = new JSObject().put("id", id).put("kind", kind);
        if (data != null) value.put("data", data);
        notifyListeners(channel, value);
    }
    private String required(PluginCall call, String field) throws IOException {
        String value = call.getString(field);
        if (value == null || value.isEmpty()) throw new IOException("Missing field");
        return value;
    }
    private String secureUrl(PluginCall call, String scheme) throws Exception {
        String value = required(call, "url");
        URI url = new URI(value);
        if (!scheme.equals(url.getScheme()) || url.getHost() == null || url.getUserInfo() != null || url.getFragment() != null) throw new IOException("Secure URL required");
        return value;
    }
    private JSObject responseHeaders(Response response) {
        JSObject headers = new JSObject();
        for (String name : response.headers().names()) headers.put(name.toLowerCase(java.util.Locale.ROOT), response.header(name));
        return headers;
    }
    private Request requestFor(PluginCall call) throws Exception {
        Request.Builder request = new Request.Builder().url(secureUrl(call, "https"));
        JSObject headers = call.getObject("headers", new JSObject());
        for (Iterator<String> keys = headers.keys(); keys.hasNext();) {
            String name = keys.next();
            if (!name.equalsIgnoreCase("content-length") && !name.equalsIgnoreCase("host") && !name.equalsIgnoreCase("cookie")) request.header(name, headers.getString(name));
        }
        String method = call.getString("method", "GET");
        RequestBody body = null;
        JSArray parts = call.getArray("parts");
        if (parts != null) {
            MultipartBody.Builder multipart = new MultipartBody.Builder().setType(MultipartBody.FORM);
            for (int i = 0; i < parts.length(); i++) {
                JSONObject part = parts.getJSONObject(i);
                if (part.has("data")) multipart.addFormDataPart(part.getString("name"), part.optString("filename", "upload"), RequestBody.create(MediaType.parse(part.optString("mimeType", "application/octet-stream")), Base64.decode(part.getString("data"), Base64.DEFAULT)));
                else multipart.addFormDataPart(part.getString("name"), part.optString("value", ""));
            }
            request.removeHeader("Content-Type");body = multipart.build();
        } else if (!method.equals("GET") && !method.equals("HEAD")) {
            String contentType = headers.optString("content-type", "");
            body = RequestBody.create(contentType.isEmpty() ? null : MediaType.parse(contentType), call.getString("body", ""));
        }
        return request.method(method, body).build();
    }
    private void start(PluginCall call, boolean streaming) {
        try {
            String id = required(call, "id");
            Call operation = http.newCall(requestFor(call));
            if (calls.putIfAbsent(id, operation) != null) throw new IOException("Duplicate request");
            operation.enqueue(new Callback() {
                public void onFailure(Call request, IOException error) {
                    calls.remove(id, request);
                    if (streaming) event("network", id, "error", null);
                    else call.reject("Native request failed or was cancelled", "NETWORK_ERROR");
                }
                public void onResponse(Call request, Response response) {
                    try (response) {
                        if (streaming) {
                            notifyListeners("network", new JSObject().put("id", id).put("kind", "headers").put("status", response.code()).put("headers", responseHeaders(response)));
                            if (response.body() != null) try (InputStream input = response.body().byteStream()) {
                                byte[] buffer = new byte[8192];int count;
                                while ((count = input.read(buffer)) != -1) {
                                    if (request.isCanceled()) break;
                                    if (count > 0) event("network", id, "chunk", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
                                }
                            }
                            event("network", id, request.isCanceled() ? "error" : "end", null);
                        } else {
                            ByteArrayOutputStream output = new ByteArrayOutputStream();
                            if (response.body() != null) try (InputStream input = response.body().byteStream()) {
                                byte[] buffer = new byte[8192];int count;
                                while ((count = input.read(buffer)) != -1) {if (output.size() + count > MAX_RESPONSE) throw new IOException("Response limit exceeded");output.write(buffer, 0, count);}
                            }
                            byte[] bytes = output.toByteArray();
                            call.resolve(new JSObject().put("status", response.code()).put("headers", responseHeaders(response)).put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)));
                        }
                    } catch (Exception error) {
                        if (streaming) event("network", id, "error", null);
                        else call.reject("Native response failed", "NETWORK_ERROR");
                    } finally { calls.remove(id, request); }
                }
            });
            if (streaming) call.resolve();
        } catch (Exception error) { call.reject("Invalid native request", "INVALID_REQUEST"); }
    }
    @PluginMethod public void request(PluginCall call) { start(call, false); }
    @PluginMethod public void stream(PluginCall call) { start(call, true); }
    @PluginMethod public void cancel(PluginCall call) {
        Call operation = calls.remove(call.getString("id", ""));if (operation != null) operation.cancel();call.resolve();
    }
    @PluginMethod public void openSocket(PluginCall call) {
        try {
            String id = required(call, "id");
            JSObject headers = call.getObject("headers", new JSObject());
            JSArray protocols = call.getArray("protocols");
            if (protocols == null || protocols.length() != 1 || !"mqtt".equals(protocols.getString(0)) || sockets.containsKey(id)) throw new IOException("MQTT protocol required");
            Request.Builder request = new Request.Builder().url(secureUrl(call, "wss")).header("Sec-WebSocket-Protocol", "mqtt");
            for (String name : new String[]{"wt", "wt2", "zp_product_id"}) request.header(name, headers.getString(name));
            WebSocket socket = http.newWebSocket(request.build(), new WebSocketListener() {
                @Override public void onOpen(WebSocket ws, Response response) {
                    if (!"mqtt".equals(response.header("Sec-WebSocket-Protocol"))) {ws.cancel();event("socket", id, "error", null);return;}
                    event("socket", id, "open", null);
                }
                @Override public void onMessage(WebSocket ws, ByteString bytes) {event("socket", id, "message", bytes.base64());}
                @Override public void onMessage(WebSocket ws, String value) {ws.close(1003, "Binary MQTT required");event("socket", id, "error", null);}
                @Override public void onClosing(WebSocket ws, int code, String reason) {ws.close(code, null);}
                @Override public void onClosed(WebSocket ws, int code, String reason) {sockets.remove(id, ws);event("socket", id, "close", null);}
                @Override public void onFailure(WebSocket ws, Throwable error, Response response) {sockets.remove(id, ws);event("socket", id, "error", null);event("socket", id, "close", null);}
            });
            sockets.put(id, socket);call.resolve();
        } catch (Exception error) { call.reject("Invalid secure socket request", "SOCKET_ERROR"); }
    }
    @PluginMethod public void sendSocket(PluginCall call) {
        try {
            WebSocket socket = sockets.get(required(call, "id"));
            if (socket == null || !socket.send(ByteString.of(Base64.decode(required(call, "data"), Base64.DEFAULT)))) throw new IOException("Socket unavailable");call.resolve();
        } catch (Exception error) {call.reject("Socket write was not accepted", "SOCKET_ERROR");}
    }
    @PluginMethod public void closeSocket(PluginCall call) {WebSocket socket = sockets.remove(call.getString("id", ""));if (socket != null) socket.cancel();call.resolve();}
    private SharedPreferences preferences() {return getContext().getSharedPreferences(VAULT, Context.MODE_PRIVATE);}
    private SecretKey secretKey() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        if (keys.containsAlias(VAULT)) return (SecretKey) keys.getKey(VAULT, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(VAULT, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    @PluginMethod public synchronized void readSession(PluginCall call) {
        try {
            SharedPreferences prefs = preferences();String value = prefs.getString("data", null), iv = prefs.getString("iv", null);
            if (value == null || iv == null) {call.resolve(new JSObject());return;}
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.DEFAULT)));
            call.resolve(new JSObject().put("value", new String(cipher.doFinal(Base64.decode(value, Base64.DEFAULT)), java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception error) {preferences().edit().clear().commit();call.reject("Secure session could not be read", "VAULT_ERROR");}
    }
    @PluginMethod public synchronized void writeSession(PluginCall call) {
        try {
            String value = required(call, "value");if (value.length() > 65536) throw new IOException("Session limit exceeded");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            String encoded = Base64.encodeToString(cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!preferences().edit().putString("data", encoded).putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) throw new IOException("Storage failed");call.resolve();
        } catch (Exception error) {call.reject("Secure session could not be saved", "VAULT_ERROR");}
    }
    @PluginMethod public synchronized void clearSession(PluginCall call) {if (preferences().edit().clear().commit()) call.resolve();else call.reject("Secure session could not be cleared", "VAULT_ERROR");}
    @Override protected void handleOnDestroy() {for (Call call : calls.values()) call.cancel();calls.clear();for (WebSocket socket : sockets.values()) socket.cancel();sockets.clear();http.dispatcher().executorService().shutdown();}
}
