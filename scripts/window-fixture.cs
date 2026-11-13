using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Collections.Generic;
class VerificationFixture {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [STAThread] static void Main(string[] args) {
    // Match the native broker's physical-pixel coordinates on scaled desktops.
    if(!SetProcessDpiAwarenessContext(new IntPtr(-4))) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    Application.EnableVisualStyles();
    using (var form = new Form { Text="Window Use MCP verification", AccessibleName="Window Use MCP verification", StartPosition=FormStartPosition.Manual, Location=new Point(80,80), Size=new Size(540,600) }) {
      var edit = new TextBox { Name="verificationInput", AccessibleName="Verification input", Location=new Point(25,35), Size=new Size(450,30), Text="before" };
      var button = new Button { Name="verificationButton", AccessibleName="Apply verification", Text="Apply verification", Location=new Point(25,85), Size=new Size(180,40) };
      var label = new Label { AccessibleName="Verification result", Text="not applied", Location=new Point(25,150), Size=new Size(450,50) };
      int clickCount=0;
      if(args.Length>0)File.WriteAllText(args[0]+".clicks","0");
      button.Click += (sender,e) => { label.Text="Applied: "+edit.Text; label.AccessibleName=label.Text; clickCount++; if(args.Length>0)File.WriteAllText(args[0]+".clicks",clickCount.ToString()); };
      var canvas = new Panel { Name="verificationCanvas", AccessibleName="Verification drawing canvas", Location=new Point(25,220), Size=new Size(450,250), BackColor=Color.White, BorderStyle=BorderStyle.FixedSingle };
      var strokes=new List<List<Point>>();
      var strokeEvents=new List<string>();
      bool recording=false,strokeOverflow=false;
      int strokeDowns=0,strokeUps=0;
      Action<string,MouseEventArgs> recordStroke=(kind,e)=>{
        var screen=canvas.PointToScreen(e.Location);
        if(strokeEvents.Count<8192)strokeEvents.Add("{\"kind\":\""+kind+"\",\"x\":"+screen.X+",\"y\":"+screen.Y+"}");
        else strokeOverflow=true;
        if(args.Length>0)File.WriteAllText(args[0]+".strokes","{\"downs\":"+strokeDowns+",\"ups\":"+strokeUps+",\"recording\":"+(recording?"true":"false")+",\"overflow\":"+(strokeOverflow?"true":"false")+",\"events\":["+String.Join(",",strokeEvents)+"]}");
      };
      canvas.MouseDown+=(sender,e)=>{
        if(e.Button!=MouseButtons.Left)return;
        strokeDowns++;recording=true;canvas.Capture=true;
        strokes.Add(new List<Point>{e.Location});recordStroke("down",e);
      };
      canvas.MouseMove+=(sender,e)=>{
        if(!recording)return;
        strokes[strokes.Count-1].Add(e.Location);recordStroke("move",e);canvas.Invalidate();
      };
      canvas.MouseUp+=(sender,e)=>{
        if(e.Button!=MouseButtons.Left||!recording)return;
        strokes[strokes.Count-1].Add(e.Location);strokeUps++;recording=false;canvas.Capture=false;
        recordStroke("up",e);canvas.Invalidate();
      };
      canvas.Paint+=(sender,e)=>{using(var pen=new Pen(Color.DodgerBlue,2))foreach(var stroke in strokes)if(stroke.Count>1)e.Graphics.DrawLines(pen,stroke.ToArray());};
      if(args.Length>0)File.WriteAllText(args[0]+".strokes","{\"downs\":0,\"ups\":0,\"recording\":false,\"overflow\":false,\"events\":[]}");
      form.Controls.AddRange(new Control[]{edit,button,label,canvas});
      int keyPresses=0;
      Action writeState=()=>{if(args.Length>0)File.WriteAllText(args[0]+".state","{\"keyPresses\":"+keyPresses+",\"length\":"+edit.Text.Length+",\"expected\":"+(edit.Text=="Window Use verified"?"true":"false")+"}");};
      edit.KeyPress += (sender,e)=>{keyPresses++;writeState();};
      edit.TextChanged += (sender,e)=>writeState();
      var activationTimer = new Timer { Interval=100 };
      activationTimer.Tick += (sender,e) => {
        if(args.Length>0 && File.Exists(args[0]+".activate")) {
          form.TopMost=true; form.Activate(); form.BringToFront();
          if(GetForegroundWindow()==form.Handle) { File.Delete(args[0]+".activate"); File.WriteAllText(args[0]+".active","true"); }
        }
      };
      activationTimer.Start();
      form.Shown += (sender,e) => { if(args.Length>0) { var p=button.PointToScreen(new Point(70,20)); var q=edit.PointToScreen(new Point(40,10)); var c=canvas.PointToScreen(Point.Empty); File.WriteAllText(args[0],"{\"buttonX\":"+p.X+",\"buttonY\":"+p.Y+",\"editX\":"+q.X+",\"editY\":"+q.Y+",\"canvasX\":"+c.X+",\"canvasY\":"+c.Y+",\"canvasWidth\":"+canvas.ClientSize.Width+",\"canvasHeight\":"+canvas.ClientSize.Height+"}"); } };
      Application.Run(form);
      activationTimer.Dispose();
    }
  }
}
