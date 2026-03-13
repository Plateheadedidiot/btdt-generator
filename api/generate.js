export default async function handler(req,res){
if(req.method!=="POST"){
return res.status(405).json({error:"Method not allowed"});
}

try{
const{prompt}=req.body||{};
if(!prompt){
  return res.status(400).json({error:"Prompt required"});
}

const finalPrompt=`Tattoo stencil design, bold black linework, white background. Idea: ${prompt}`;

const response=await fetch("https://api.openai.com/v1/images/generations",{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
},
body:JSON.stringify({
model:"gpt-image-1",
prompt:finalPrompt,
size:"1024x1024"
})
});

const data=await response.json();

if(!response.ok){
  return res.status(response.status).json(data);
}

return res.status(200).json(data);

}catch(e){
return res.status(500).json({error:"Server error"});
}
}
