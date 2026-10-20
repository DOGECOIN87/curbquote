package com.mattrick.graphscore;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.*;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.util.*;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
  WebView web;
  static final int SAVE_FILE=191, OPEN_FILE=192;
  ValueCallback<Uri[]> fileCallback;
  static class Pending {
    File f; String name, mime; FileOutputStream out;
    Pending(File f,String name,String mime,FileOutputStream out) {this.f=f;this.name=name;this.mime=mime;this.out=out;}
  }
  final Map<String,Pending> inProgress=new HashMap<>();
  Pending saving;
  @Override public void onCreate(Bundle state){
    super.onCreate(state);
    getWindow().setStatusBarColor(0xff101115);
    getWindow().setNavigationBarColor(0xff101115);
    web=new WebView(this);web.setBackgroundColor(0xff101115);
    WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
    s.setAllowFileAccess(true);s.setAllowContentAccess(true);
    s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);
    s.setMediaPlaybackRequiresUserGesture(false);
    web.addJavascriptInterface(new Bridge(),"GraphscoreAndroid");
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest req){
        Uri u=req.getUrl();
        if("file".equals(u.getScheme()))return false;
        if("https".equals(u.getScheme())){try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception e){}}
        return true;
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback, FileChooserParams params){
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        fileCallback=callback;
        try{startActivityForResult(params.createIntent(),OPEN_FILE);return true;}
        catch(Exception e){fileCallback=null;callback.onReceiveValue(null);return false;}
      }
    });
    setContentView(web);
    web.loadUrl("file:///android_asset/index.html");
  }
  final class Bridge {
    @JavascriptInterface public String beginFile(String name,String mime){
      try{
        String safe=(name==null?"graphscore-export":name.replaceAll("[^a-zA-Z0-9._-]","_"));
        if(safe.length()>100)safe=safe.substring(0,100);
        File f=File.createTempFile("graphscore-", ".tmp", getCacheDir());
        String token=UUID.randomUUID().toString();
        synchronized(inProgress){inProgress.put(token,new Pending(f,safe,mime==null?"application/octet-stream":mime,new FileOutputStream(f)));}
        return token;
      }catch(Exception e){return "";}
    }
    @JavascriptInterface public boolean appendFile(String id,String data){
      try{Pending p; synchronized(inProgress){p=inProgress.get(id);}
        if(p==null)return false; synchronized(p){p.out.write(Base64.decode(data,Base64.DEFAULT));}return true;
      }catch(Exception e){return false;}
    }
    @JavascriptInterface public void finishFile(String id){
      Pending p; synchronized(inProgress){p=inProgress.remove(id);}if(p==null)return;
      try{p.out.close();}catch(Exception e){p.f.delete();return;}
      runOnUiThread(()->{
        if(saving!=null){p.f.delete();Toast.makeText(MainActivity.this,"Complete previous save first",Toast.LENGTH_SHORT).show();return;}
        saving=p;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(p.mime);
        i.putExtra(Intent.EXTRA_TITLE,p.name);
        try{startActivityForResult(i,SAVE_FILE);}
        catch(Exception e){p.f.delete();saving=null;Toast.makeText(MainActivity.this,"Save dialog unavailable",Toast.LENGTH_LONG).show();}
      });
    }
    @JavascriptInterface public void mcpRequest(int id,String endpoint,String token,String session,String payload){
      new Thread(()->{
        JSONObject answer=new JSONObject();HttpURLConnection c=null;
        try{
          URL u=new URL(endpoint);
          if(!"https".equalsIgnoreCase(u.getProtocol()) || u.getUserInfo()!=null)throw new Exception("Only HTTPS MCP endpoints");
          c=(HttpURLConnection)u.openConnection();c.setRequestMethod("POST");c.setConnectTimeout(12000);c.setReadTimeout(24000);
          c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");
          c.setRequestProperty("Accept","application/json, text/event-stream");
          c.setRequestProperty("MCP-Protocol-Version","2025-06-18");
          if(token!=null && !token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);
          if(session!=null && !session.isEmpty())c.setRequestProperty("Mcp-Session-Id",session);
          try(OutputStream out=c.getOutputStream()){out.write(payload.getBytes(StandardCharsets.UTF_8));}
          int status=c.getResponseCode();InputStream s=status>=400?c.getErrorStream():c.getInputStream();
          ByteArrayOutputStream b=new ByteArrayOutputStream();
          if(s!=null)try(InputStream in=s){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){if(b.size()+n>2000000)throw new Exception("Response exceeds 2MB");b.write(block,0,n);}}
          answer.put("status",status);answer.put("body",new String(b.toByteArray(),StandardCharsets.UTF_8));
          String next=c.getHeaderField("Mcp-Session-Id");answer.put("session",next==null?session:next);
        }catch(Exception e){try{answer.put("error",String.valueOf(e.getMessage()));}catch(Exception ignored){}}
        finally{if(c!=null)c.disconnect();}
        String quoted=JSONObject.quote(answer.toString());
        runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.GraphscoreMCP&&window.GraphscoreMCP.onReply("+id+","+quoted+");",null);});
      }).start();
    }
  }
  @Override protected void onActivityResult(int request,int result, Intent data){
    super.onActivityResult(request,result,data);
    if(request==OPEN_FILE){if(fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileCallback=null;}}
    if(request==SAVE_FILE){
      Pending p=saving;saving=null;if(p==null)return;
      try{
        if(result==RESULT_OK && data!=null && data.getData()!=null){
          try(InputStream in=new FileInputStream(p.f);OutputStream out=getContentResolver().openOutputStream(data.getData())){
            if(out==null)throw new IOException("No writable destination");
            byte[] block=new byte[16384];int n;while((n=in.read(block))!=-1)out.write(block,0,n);
          }
          Toast.makeText(this,"Saved "+p.name,Toast.LENGTH_SHORT).show();
        }
      }catch(Exception e){Toast.makeText(this,"Save failed: "+e.getMessage(),Toast.LENGTH_LONG).show();}
      finally{p.f.delete();}
    }
  }
  @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
  @Override protected void onDestroy(){super.onDestroy();if(web!=null)web.destroy();}
}