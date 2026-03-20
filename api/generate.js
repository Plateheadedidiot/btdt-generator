export default async function handler(req,res){
  if(req.method !== "POST") return res.status(405).end();

  const {prompt} = req.body;

  const r = await fetch("https://api.openai.com/v1/images/generations",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer " + process.env.OPENAI_API_KEY
    },
    body:JSON.stringify({
      model:"gpt-image-1",
      prompt,
      size:"1024x1024"
    })
  });

  const j = await r.json();
  res.json({image:j.data[0].b64_json});
}
